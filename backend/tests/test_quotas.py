import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx

from app.services.quota_probe import parse_report, fatal_diagnostics, collect
from app.api import quotas
from app.api.deps import get_server_or_404, get_ssh
from app.core.deps import current_user
from app.main import create_app
from app.models import User

XML = """<?xml version="1.0"?><repquota>
<Report type="user" dev="/dev/nvme0n1p2">
<Quota user="#1001"><blockLimits used="2048" soft="1024" hard="4096" grace="1700000000"/>
<FileLimits used="45" soft="50" hard="60" grace="0"/></Quota></Report>
<Report type="user" dev="/dev/sda1">
<Quota user="#1002"><blockLimits used="0" soft="0" hard="0" grace="0"/>
<FileLimits used="0" soft="0" hard="0" grace="0"/></Quota></Report></repquota>"""


class ParserTests(unittest.TestCase):
    def test_unprivileged_incomplete_xml_retries_sudo(self):
        warning = 'repquota: Cannot stat() mounted device tmpfs: No such file or directory'
        incomplete = SimpleNamespace(returncode=0, stdout='<repquota><Report></repquota>', stderr=warning)
        complete = SimpleNamespace(returncode=0, stdout=XML, stderr=warning)
        with patch.dict('sys.modules', {'pwd': SimpleNamespace(getpwall=lambda: [])}), \
             patch('app.services.quota_probe.os.geteuid', return_value=1001, create=True), \
             patch('app.services.quota_probe.shutil.which', side_effect=lambda name: '/usr/sbin/repquota' if name == 'repquota' else '/usr/bin/sudo'), \
             patch('app.services.quota_probe.subprocess.run', side_effect=[incomplete, complete]) as run:
            report = collect()
        self.assertEqual(report['state'], 'ready')
        self.assertEqual(len(report['entries']), 2)
        self.assertEqual(run.call_args_list[1].args[0][:2], ['sudo', '-n'])

    def test_missing_tmpfs_warning_is_not_a_quota_failure(self):
        warning = 'repquota: Cannot stat() mounted device tmpfs: No such file or directory'
        self.assertEqual(fatal_diagnostics(warning + '\n' + warning), '')
        self.assertIn('Permission denied', fatal_diagnostics(warning + '\nPermission denied'))
        self.assertIn('/dev/sda1', fatal_diagnostics('repquota: Cannot stat() mounted device /dev/sda1: No such file or directory'))

    def test_units_names_grace_and_multiple_filesystems(self):
        rows = parse_report(XML, {1001: 'alice'})
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]['username'], 'alice')
        self.assertEqual(rows[0]['used_bytes'], 2048 * 1024)
        self.assertEqual(rows[0]['soft_bytes'], 1024 * 1024)
        self.assertEqual(rows[0]['hard_bytes'], 4096 * 1024)
        self.assertEqual(rows[0]['grace_expires'], 1700000000)
        self.assertEqual(rows[0]['files_used'], 45)
        self.assertIsNone(rows[0]['files_grace_expires'])
        self.assertEqual(rows[1]['username'], '#1002')
        self.assertEqual(rows[1]['hard_bytes'], 0)

    def test_empty_report_and_incomplete_report(self):
        self.assertEqual(parse_report('<repquota/>', {}), [])
        with self.assertRaises(ValueError):
            parse_report('<repquota><Report><Quota user="#1"/></Report></repquota>', {})


class EndpointTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        quotas._cache.clear()
        quotas._locks.clear()
        self.app = create_app()
        self.app.dependency_overrides[current_user] = lambda: User(id=1, username='test', role='admin', is_active=True)
        server = SimpleNamespace(id=1, transport='ssh', hostname='test', port=22, username='test', key_path=None, ssh_config_host=None)
        self.app.dependency_overrides[get_server_or_404] = lambda: server
        self.run = AsyncMock(return_value=SimpleNamespace(exit_status=0, stdout='{"state":"ready","entries":[]}'))
        self.ssh = SimpleNamespace(get=AsyncMock(return_value=SimpleNamespace(run=self.run)))
        self.app.dependency_overrides[get_ssh] = lambda: self.ssh
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url='http://test')

    async def asyncTearDown(self):
        await self.client.aclose()

    async def test_admin_and_cache(self):
        first = await self.client.get('/api/servers/1/quotas')
        second = await self.client.get('/api/servers/1/quotas')
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json()['checked_at'], second.json()['checked_at'])
        self.run.assert_awaited_once()

    async def test_viewer_cannot_read_all_user_quotas(self):
        self.app.dependency_overrides[current_user] = lambda: User(id=2, username='viewer', role='viewer', is_active=True)
        self.assertEqual((await self.client.get('/api/servers/1/quotas')).status_code, 403)
        self.run.assert_not_awaited()

    async def test_remote_failure_is_not_zero_usage(self):
        self.run.return_value = SimpleNamespace(exit_status=1, stdout='')
        self.assertEqual((await self.client.get('/api/servers/1/quotas')).status_code, 502)

    async def test_permission_state_is_preserved(self):
        self.run.return_value = SimpleNamespace(exit_status=0, stdout='{"state":"permission_required","entries":[],"message":"sudo required"}')
        result = await self.client.get('/api/servers/1/quotas')
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()['state'], 'permission_required')


if __name__ == '__main__':
    unittest.main()
