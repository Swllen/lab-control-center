# Lab Server Control Center

A web control plane for Linux GPU servers used in AI research: live hardware monitoring, and later web terminals, an SFTP file manager, transfers, and a GPU-aware experiment queue.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design, data models, API, and phased plan.

## Status

| Phase | Scope | State |
|---|---|---|
| 1 | Scaffold, auth, server config and connection test, SSH pool, real-time metrics, dashboard, servers, hardware | ✅ done |
| 2 | xterm.js terminals: tabs, 1×1 / 1×2 / 2×2 splits, reconnect/duplicate/maximize, refresh-safe sessions | ✅ done |
| 3 | SFTP file manager (tree, breadcrumbs, drag-and-drop, rename/move/delete), streaming upload/download with Range resume, server-to-server copy, live transfers with cancel/retry | ✅ done |
| 4 | Job queue (create/cancel/retry/duplicate, live logs, progress), YAML parameter sweeps, GPU-aware scheduler | ✅ done |
| 5 | Logs, notifications, preferences polish | planned |

## Run (development)

Requirements: [uv](https://docs.astral.sh/uv/) and Node 20+.

```bash
# backend → http://127.0.0.1:8600
cd backend
cp .env.example .env      # then edit it (works in PowerShell too; avoid `echo > .env`, which writes UTF-16 there)
uv run uvicorn app.main:app --port 8600 --reload
```

```bash
# frontend → http://localhost:3000
cd frontend
npm install
npm run dev
```

### Access from other machines on the LAN

1. Start the backend with `--host 0.0.0.0` (`uv run uvicorn app.main:app --host 0.0.0.0 --port 8600 --reload`).
2. Add `http://<LAN-IP>:3000` to `LCC_ALLOWED_ORIGINS` in `backend/.env`, and `<LAN-IP>` to `LCC_DEV_ORIGINS` in `frontend/.env.local` (dev mode only).
3. Allow inbound TCP 3000 and 8600 in the firewall (Private network only).
4. Open `http://<LAN-IP>:3000` from the other machine. Change the default admin password first: anyone on the network can reach the login page.

Sign in as `admin` with `LCC_ADMIN_PASSWORD` (if unset, a random password is written to `backend/data/`). With `LCC_DEMO_MODE=true`, a fresh database is seeded with two **simulated** servers plus sample jobs and transfers.

## Adding a real server

1. On the machine that runs the backend, make sure `ssh user@host` already works with a key in `~/.ssh`. This also puts the host key in `known_hosts`, which is verified by default.
2. **Servers → Add server**: enter the hostname, user, and key path (for example `~/.ssh/id_ed25519`), or leave the key path empty to use ssh-agent. Click **Test connection**, then save.
3. The remote server only needs `python3`. GPU metrics use `pynvml` (`pip install nvidia-ml-py`) when it's installed, otherwise `nvidia-smi`.
4. Restart and shutdown need passwordless sudo for `systemctl reboot` / `systemctl poweroff`.

## Configuration (backend env, prefix `LCC_`)

| Variable | Default | Purpose |
|---|---|---|
| `LCC_DATABASE_URL` | `sqlite+aiosqlite:///backend/data/lcc.db` | Any SQLAlchemy async URL (e.g. `postgresql+asyncpg://…`) |
| `LCC_ADMIN_PASSWORD` | random | Initial admin password (first run only) |
| `LCC_SSH_KEY_DIRS` | `["~/.ssh"]` | Directories that key paths must resolve into |
| `LCC_SSH_KNOWN_HOSTS` | `auto` | `auto`, `ignore`, or a path |
| `LCC_METRICS_INTERVAL_S` | `2.0` | Probe sampling interval |
| `LCC_ALLOWED_ORIGINS` | localhost:3000 | CORS and WebSocket origin allow-list |
| `LCC_DEMO_MODE` | `true` | Seed simulated servers into an empty DB |

The frontend reads `LCC_BACKEND_URL` (REST proxy target) and `NEXT_PUBLIC_LCC_WS_PORT` (WebSocket port). See `frontend/.env.example`.

## Jobs and sweeps

- Each job runs detached on the server (`setsid -f`, which needs util-linux 2.31 or newer) from `~/.lcc/jobs/<id>/run.sh`, under `bash -l`. It survives SSH drops and control-center restarts. `stdout.log`, `stderr.log`, `exit_code` and `pid` are written to that folder.
- The scheduler checks every 5 s. A queued job starts when the server is below `max_jobs` **and** enough GPUs are idle: not assigned to another control-center job, under 10 % memory and under 15 % utilization (`LCC_GPU_FREE_MAX_MEM_FRAC`, `LCC_GPU_FREE_MAX_UTIL`). Queued jobs are taken in order, but a smaller job further back can start first when the first one doesn't fit. The chosen GPUs are exported as `CUDA_VISIBLE_DEVICES`. CPU-only jobs get an empty value.
- **Progress:** write `0.42` or `42%` to `$LCC_PROGRESS_FILE`.
- **Cancel** sends SIGTERM to the job's process group, then SIGKILL after 10 s.
- **Sweeps:** YAML `parameters:` mapping → cartesian product. `{name}` placeholders are substituted; parameters the command doesn't reference are appended as `--name=value`.
- **Conda:** a non-interactive login shell does not run the conda hook from `.bashrc`, so start commands with `source ~/miniconda3/etc/profile.d/conda.sh && conda activate <env> && …`.
- The scheduler implements a `Scheduler` protocol (`app/services/job_scheduler.py`), so a Slurm backend can replace it.
