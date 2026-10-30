import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import httpx
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.deps import current_user
from app.db.session import get_db
from app.db.base import Base
from app.db.init_db import create_schema
from app.main import create_app
from app.models import Job, Server, User
from app.schemas.job import JobCreate
from app.services.job_scheduler import place, render_run_script


def job(id, count, selected=None):
    return Job(id=id, name='test', gpus_requested=count, requested_gpu_indices=selected)


class PlacementTests(unittest.TestCase):
    def test_busy_selected_gpu_does_not_fall_back(self):
        placements, waiting = place([job(1, 1, [2]), job(2, 1)], 0, 2, [0, 1], 4)
        self.assertEqual([(p.job_id, p.gpu_indices) for p in placements], [(2, [0])])
        self.assertIn('busy: [2]', waiting[1])

    def test_selection_preserves_order_and_reserves_cards(self):
        placements, waiting = place([job(1, 2, [3, 1]), job(2, 1, [1]), job(3, 1)], 0, 3, [0, 1, 2, 3], 4)
        self.assertEqual([(p.job_id, p.gpu_indices) for p in placements], [(1, [3, 1]), (3, [0])])
        self.assertIn(2, waiting)

    def test_noncontiguous_inventory_and_missing_gpu(self):
        placements, waiting = place([job(1, 1, [3]), job(2, 1, [1])], 0, 2, [0, 3], 2, [0, 3])
        self.assertEqual(placements[0].gpu_indices, [3])
        self.assertIn('not found', waiting[2])

    def test_cpu_jobs_and_concurrency_unchanged(self):
        placements, waiting = place([job(1, 0), job(2, 1, [0])], 0, 1, [0], 1)
        self.assertEqual(placements[0].gpu_indices, [])
        self.assertIn('max concurrent', waiting[2])

    def test_bad_selections_rejected(self):
        for selected, count in [([], 0), ([1, 1], 2), ([-1], 1), ([True], 1), ([1], 2), ([1.5], 1)]:
            with self.subTest(selected=selected), self.assertRaises(ValidationError):
                JobCreate(server_id=1, name='test', command='true', gpus=count, requested_gpu_indices=selected)

    def test_selected_cards_exported_to_cuda(self):
        task = job(1, 2, [2, 3])
        task.env, task.working_dir, task.command = {}, '~', 'python train.py'
        self.assertIn('export CUDA_VISIBLE_DEVICES=2,3', render_run_script(task, '/tmp/job', [2, 3]))


class MigrationTests(unittest.IsolatedAsyncioTestCase):
    async def test_existing_jobs_keep_auto_assignment(self):
        engine = create_async_engine('sqlite+aiosqlite:///:memory:')
        try:
            async with engine.begin() as conn:
                await conn.execute(text('CREATE TABLE jobs (id INTEGER PRIMARY KEY)'))
                await conn.execute(text('INSERT INTO jobs (id) VALUES (1)'))
            with patch('app.db.init_db.engine', engine):
                await create_schema()
                await create_schema()  # additive migration is idempotent
            async with engine.connect() as conn:
                value = await conn.scalar(text('SELECT requested_gpu_indices FROM jobs WHERE id=1'))
                self.assertIsNone(value)
        finally:
            await engine.dispose()


class JobApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine('sqlite+aiosqlite:///:memory:')
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False)
        async with self.sessions() as db:
            db.add(Server(id=1, name='test', hostname='test', username='test', transport='ssh'))
            await db.commit()
        app = create_app()
        async def db_override():
            async with self.sessions() as db:
                yield db
        app.dependency_overrides[get_db] = db_override
        app.dependency_overrides[current_user] = lambda: User(id=1, username='admin', role='admin', is_active=True)
        app.state.scheduler = SimpleNamespace(wake=Mock(), wait_reason=lambda id: 'Waiting')
        app.state.hub = SimpleNamespace(get=lambda id: SimpleNamespace(static=SimpleNamespace(gpus=[SimpleNamespace(index=i) for i in [0, 2, 3]])))
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test')

    async def asyncTearDown(self):
        await self.client.aclose()
        await self.engine.dispose()

    async def test_create_duplicate_retry_keep_selection(self):
        response = await self.client.post('/api/jobs', json=dict(server_id=1, name='pinned', command='true', gpus=2, requested_gpu_indices=[2, 3]))
        self.assertEqual(response.status_code, 201, response.text)
        created = response.json()
        self.assertEqual(created['requested_gpu_indices'], [2, 3])
        self.assertIsNone(created['gpu_indices'])
        duplicate = await self.client.post('/api/jobs/%s/duplicate' % created['id'])
        self.assertEqual(duplicate.status_code, 201)
        self.assertEqual(duplicate.json()['requested_gpu_indices'], [2, 3])
        async with self.sessions() as db:
            task = await db.get(Job, created['id'])
            task.status, task.gpu_indices = 'failed', [2, 3]
            await db.commit()
        retried = await self.client.post('/api/jobs/%s/retry' % created['id'])
        self.assertEqual(retried.status_code, 200)
        self.assertEqual(retried.json()['requested_gpu_indices'], [2, 3])
        self.assertIsNone(retried.json()['gpu_indices'])

    async def test_nonexistent_gpu_rejected_before_queueing(self):
        response = await self.client.post('/api/jobs', json=dict(server_id=1, name='bad', command='true', gpus=1, requested_gpu_indices=[1]))
        self.assertEqual(response.status_code, 422)

    async def test_sweep_preserves_selection(self):
        response = await self.client.post('/api/sweeps', json=dict(server_id=1, name='sweep', command='true --lr {lr}', gpus=1, requested_gpu_indices=[3], parameters={'lr': [1, 2]}))
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(len(response.json()), 2)
        self.assertTrue(all(task['requested_gpu_indices'] == [3] for task in response.json()))


if __name__ == '__main__':
    unittest.main()
