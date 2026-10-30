"""Schema creation and first-run seeding.

``create_all`` is used for the SQLite bootstrap; add Alembic migrations before moving to
PostgreSQL in production.
"""

from __future__ import annotations

import logging
import secrets
from datetime import timedelta

from sqlalchemy import func, select

from app.config import get_settings
from app.core.security import hash_password
from app.db.base import Base, utcnow
from app.db.session import SessionLocal, engine
from app.models import Job, Role, Server, Transfer, User

log = logging.getLogger(__name__)


_ADDED_COLUMNS = {
    "servers": {"ssh_config_host": "VARCHAR(255)"},
    "jobs": {"error": "TEXT", "requested_gpu_indices": "JSON"},
}


async def create_schema() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        if engine.dialect.name == "sqlite":
            for table, columns in _ADDED_COLUMNS.items():
                rows = await conn.exec_driver_sql(f"PRAGMA table_info({table})")
                present = {r[1] for r in rows}
                for column, ddl in columns.items():
                    if column not in present:
                        await conn.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")


async def ensure_admin() -> None:
    settings = get_settings()
    async with SessionLocal() as db:
        if await db.scalar(select(func.count()).select_from(User)):
            return
        password = settings.admin_password
        if not password:
            password = secrets.token_urlsafe(12)
            path = settings.data_dir / "initial_admin_password.txt"
            path.write_text(f"{settings.admin_username}\n{password}\n")
            log.warning("Created admin user '%s'. Password written to %s", settings.admin_username, path)
        db.add(User(
            username=settings.admin_username,
            display_name="Lab Admin",
            password_hash=hash_password(password),
            role=Role.admin.value,
        ))
        await db.commit()


async def seed_demo() -> None:
    """Populate simulated servers + sample jobs/transfers when the DB has no servers."""
    if not get_settings().demo_mode:
        return
    async with SessionLocal() as db:
        if await db.scalar(select(func.count()).select_from(Server)):
            return
        lab = Server(name="tyw-lab", hostname="192.168.1.10", username="research", transport="demo",
                     tags=["AI Training"], description="4× H100 training node", max_jobs=4)
        gpu2 = Server(name="gpu-server-2", hostname="192.168.1.22", username="research", transport="demo",
                      tags=["Inference / Experiments"], description="8× A6000 experiment node", max_jobs=8)
        db.add_all([lab, gpu2])
        await db.flush()

        now = utcnow()
        h = lambda hours: now - timedelta(hours=hours)  # noqa: E731
        db.add_all([
            Job(name="train-llama-70b", server_id=lab.id, working_dir="~/projects/llama", gpus_requested=4,
                command="torchrun --nproc_per_node 4 train.py --config configs/70b.yaml", status="running",
                progress=0.68, gpu_indices=[0, 1, 2, 3], started_at=h(2.23), created_at=h(2.3)),
            Job(name="eval-gpt4o", server_id=gpu2.id, working_dir="~/evals", gpus_requested=2,
                command="python eval.py --model gpt4o --suite full", status="running", progress=0.42,
                gpu_indices=[0, 1], started_at=h(1.62), created_at=h(3)),
            Job(name="data-preprocess", server_id=lab.id, working_dir="~/data", gpus_requested=0,
                command="python preprocess.py --shards 256", status="completed", progress=1.0, exit_code=0,
                started_at=h(6), ended_at=h(4.63), created_at=h(6.1)),
            Job(name="finetune-vision", server_id=gpu2.id, working_dir="~/vision", gpus_requested=4,
                command="python finetune.py --lr 3e-4 --bs 8", status="queued", params={"lr": 3e-4, "bs": 8},
                created_at=h(0.5)),
            Job(name="generate-samples", server_id=lab.id, working_dir="~/projects/llama", gpus_requested=1,
                command="python sample.py --n 10000", status="completed", progress=1.0, exit_code=0,
                started_at=h(12), ended_at=h(11.28), created_at=h(12.1)),
        ])
        m = lambda minutes: now - timedelta(minutes=minutes)  # noqa: E731
        GB = 1024**3
        db.add_all([
            Transfer(direction="upload", filename="dataset_v2.tar.gz", dest_server_id=lab.id,
                     source_path="dataset_v2.tar.gz", dest_path="/data/datasets/dataset_v2.tar.gz",
                     size_bytes=int(12.5 * GB), transferred_bytes=int(12.5 * GB), status="completed",
                     started_at=m(9), ended_at=m(2), created_at=m(9)),
            Transfer(direction="download", filename="results_run42/", is_directory=True, source_server_id=gpu2.id,
                     source_path="/data/results/results_run42", size_bytes=int(8.1 * GB),
                     transferred_bytes=int(8.1 * GB), status="completed", started_at=m(20), ended_at=m(14),
                     created_at=m(20)),
            Transfer(direction="download", filename="checkpoints/", is_directory=True, source_server_id=lab.id,
                     source_path="/data/ckpt/llama-70b", size_bytes=int(42.8 * GB),
                     transferred_bytes=int(42.8 * GB * 0.36), status="transferring", started_at=m(6),
                     created_at=m(6)),
            Transfer(direction="download", filename="logs/train.log", source_server_id=gpu2.id,
                     source_path="/home/research/logs/train.log", size_bytes=320 * 1024**2,
                     transferred_bytes=320 * 1024**2, status="completed", started_at=m(61), ended_at=m(60),
                     created_at=m(61)),
            Transfer(direction="upload", filename="configs/", is_directory=True, dest_server_id=lab.id,
                     dest_path="/home/research/projects/llama/configs", size_bytes=int(6.3 * 1024**2),
                     transferred_bytes=int(6.3 * 1024**2), status="completed", started_at=m(121),
                     ended_at=m(120), created_at=m(121)),
        ])
        await db.commit()
        log.info("Seeded demo servers, jobs and transfers")
