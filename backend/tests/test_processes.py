import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx

from app.api import processes
from app.api.deps import get_server_or_404, get_ssh
from app.core.deps import current_user
from app.main import create_app
from app.models import User
from app.services.process_probe import parse_processes


class ParserTests(unittest.TestCase):
    def test_multicore_cpu_and_command_spaces(self):
        row = parse_processes('42 1 1001 Sl 1.2 2048 7200 python train.py --name two words',
                              {1001: 'alice'}, {42: (10, 'start', 1.0)},
                              {42: (160, 'start', 1.5)}, 100)[0]
        self.assertEqual(row['cpu_percent'], 300)
        self.assertEqual(row['rss_bytes'], 2097152)
        self.assertEqual(row['username'], 'alice')
        self.assertEqual(row['command'], 'python train.py --name two words')

    def test_reused_or_new_pid_has_no_cpu_estimate(self):
        rows = parse_processes('42 1 1001 S 0.0 0 5 sleep 100', {},
                               {42: (1000, 'old', 1.0)}, {42: (1, 'new', 1.5)}, 100)
        self.assertIsNone(rows[0]['cpu_percent'])
        self.assertEqual(rows[0]['username'], '#1001')
        self.assertIsNone(parse_processes('43 1 0 S 0 0 1 sleep 1', {}, {}, {}, 100)[0]['cpu_percent'])

    def test_truncation_is_explicit(self):
        row = parse_processes('1 0 0 S 0 0 1 ' + 'x' * 3000, {}, {}, {}, 100)[0]
        self.assertTrue(row['command_truncated'])
        self.assertEqual(len(row['command']), 2048)


class EndpointTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        processes._cache.clear()
        processes._locks.clear()
        self.app = create_app()
        self.app.dependency_overrides[current_user] = lambda: User(id=1, username='admin', role='admin', is_active=True)
        self.app.dependency_overrides[get_server_or_404] = lambda: SimpleNamespace(id=1, transport='ssh', hostname='test', port=22, username='test', key_path=None, ssh_config_host=None)
        self.run = AsyncMock(return_value=SimpleNamespace(exit_status=0, stdout='{"entries":[],"ssh_user":"alice"}'))
        self.app.dependency_overrides[get_ssh] = lambda: SimpleNamespace(get=AsyncMock(return_value=SimpleNamespace(run=self.run)))
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url='http://test')

    async def asyncTearDown(self):
        await self.client.aclose()

    async def test_cache_and_no_store(self):
        response = await self.client.get('/api/servers/1/processes')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['cache-control'], 'no-store')
        await self.client.get('/api/servers/1/processes')
        self.run.assert_awaited_once()

    async def test_non_admin_cannot_read_commands(self):
        self.app.dependency_overrides[current_user] = lambda: User(id=2, username='op', role='operator', is_active=True)
        self.assertEqual((await self.client.get('/api/servers/1/processes')).status_code, 403)
        self.run.assert_not_awaited()

    async def test_probe_failure_is_an_error(self):
        self.run.return_value = SimpleNamespace(exit_status=1, stdout='')
        self.assertEqual((await self.client.get('/api/servers/1/processes')).status_code, 502)


if __name__ == '__main__':
    unittest.main()
