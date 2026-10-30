# Lab Server Control Center

A browser-based control center for Linux GPU servers: hardware monitoring, SSH/tmux
terminals, SFTP files and transfers, GPU-aware experiment queues, disk quotas and processes.
The backend connects over SSH; no persistent management agent is installed remotely.

[中文说明](README.zh-CN.md) · [Job guide](docs/JOBS.md) ·
[Quota setup](docs/QUOTAS.md) · [Architecture](docs/ARCHITECTURE.md) · [Security](SECURITY.md)

## Features

| Area | Available functionality |
|---|---|
| Monitoring | CPU/RAM, per-GPU utilization/VRAM/temperature, disks, network and history |
| Terminals | Tabs, split panes, optional tmux, reattach and tmux history |
| Files | SFTP operations, uploads/downloads, previews of text/code, JSON/JSONL, Markdown, CSV and images |
| Transfers | Streaming and server-to-server transfers, progress, cancel/retry |
| Jobs | Wait for idle GPUs, auto-assign or select specific GPUs, YAML sweeps, logs, cancel/retry/duplicate |
| Job history | Bulk-delete finished records with confirmation; active jobs are protected |
| Quotas | Admin-only per-user filesystem usage, soft/hard space/inode limits and grace periods |
| Processes | Admin-only snapshots across users, CPU/RSS/runtime sorting, search and filters |
| Settings | Appearance, account profile, AI assistant and copyable LAN addresses |
| Extras | Animated server mascots driven by existing telemetry |

The **Logs** page is still a placeholder for a unified timeline. Individual job logs
and frontend access logs work. Notifications, token approval, MFA and a comprehensive
audit trail are not implemented.

## Requirements

- Control-center host: Python **3.12+**, [uv](https://docs.astral.sh/uv/), Node.js
  **20.9+** and npm. Local validation uses Node.js 24. The double-click launchers need Windows.
- Remote Linux hosts: SSH and Python 3. The main telemetry probe supports Python
  3.6+; optional quota/process probes require Python 3.7+.
- GPU monitoring: NVIDIA drivers with `nvidia-smi`; `nvidia-ml-py` is optional.
- Optional remote tools: `tmux` for persistent shells; procps `ps` and `/proc` for
  processes; quota-tools `repquota` with active user quotas for quota reports.
- Jobs need `setsid` and standard Linux shell utilities.

## First-time setup

```sh
git clone https://github.com/Swllen/lab-control-center.git
cd lab-control-center/backend
cp .env.example .env
uv sync
cd ../frontend
cp .env.example .env.local
npm ci
```

These commands work in PowerShell and POSIX shells. Edit `backend/.env` before
first startup. Leave `LCC_ADMIN_PASSWORD` empty to generate a random initial
password, or set a strong unique password. The initial username defaults to `admin`.
Generated credentials are written to `backend/data/initial_admin_password.txt`.

Bootstrap runs **only if there are no users**. Editing `LCC_ADMIN_PASSWORD` later
does not reset an existing account. If you rename the account in Settings, use the
new username next time. Keep credential files private.

## Windows startup

| Command / double-click launcher | Behavior |
|---|---|
| `start.cmd` | Local-only services; open the browser |
| `start-lan.cmd` | LAN services; open the browser |
| `start.cmd -CheckOnly` | Check setup without starting/stopping services |
| `start.cmd -NoBrowser` | Start without opening a browser |

Open <http://localhost:3000>. Services run in the background, with output in `logs/`.
The launcher **reuses running services**, never kills them, and starts the backend
without auto-reload. Saving code therefore does not unexpectedly disconnect terminals.

### Another computer on the LAN

1. Use `start-lan.cmd`. Stop previously started localhost-only services first;
   the launcher does not reconfigure an existing process.
2. In **Settings → 局域网访问**, copy the physical network address, for example
   `http://192.168.1.20:3000` (example only).
3. Open that address on the other computer and sign in with a control-center account.

LAN startup binds new services to all interfaces and adds detected private IPv4
addresses to allowed origins **for that launch**, preserving existing origins.
It does not edit env files or the firewall. Ports **3000 and 8600** must both be
reachable: REST uses the frontend proxy, while WebSockets and large file streams
use the backend directly. Restrict firewall rules to trusted peers/networks.
Displaying an address does not prove remote connectivity; Wi-Fi isolation can block it.

## Manual startup

Run in separate terminals:

```sh
cd backend
uv run uvicorn app.main:app --host 127.0.0.1 --port 8600
```

```sh
cd frontend
npm run dev -- --hostname 127.0.0.1
```

For manual LAN access, bind both services to `0.0.0.0`. Add `http://<LAN-IP>:3000`
to the JSON array `LCC_ALLOWED_ORIGINS` in `backend/.env`, and the bare IP to the
comma-separated `LCC_DEV_ORIGINS` in `frontend/.env.local`. Restart affected services.
Backend `--reload` is optional for development, but reloads disconnect plain shells.

## Add a server

1. Connect from the control-center host using `ssh labuser@your-server` and verify
   the host key, creating `~/.ssh/known_hosts` before adding the server.
2. In **Servers**, enter the host, port, SSH username and key path, or import an
   alias from `~/.ssh/config`. A missing explicit key uses the SSH agent.
3. Test and save. Install optional remote tools only for features you use.

Web users operate through the configured SSH login, not automatically through their
own Linux accounts. Only grant access to people trusted with those remote permissions.

## Jobs and everyday use

- **Jobs:** set server, working directory, command and GPU count. **0 means CPU-only.**
  Choose **Select GPUs** to pin physical indices; all selected cards must become free.
  [Job guide](docs/JOBS.md) covers conda, sweeps, progress and troubleshooting.
- **Cancel versus delete:** Cancel stops the job and keeps history. Select finished
  records and choose **Delete selected** to remove history; remote output remains.
- **Terminals:** Use tmux for persistence. Missing remote tmux falls back to a plain
  shell. Plain shells do not survive backend restarts; tmux sessions can be reattached.
- **Files:** double-click to preview. Large text is truncated; download the full file
  when needed. Large directories render visible rows rather than every row at once.
- **Quotas:** usage is charged to file owners across each filesystem, not just home
  directories. See [quota permissions](docs/QUOTAS.md) for the exact read-only sudo rule.
- **Processes:** shows processes visible to the SSH login. CPU is sampled over about
  0.5 seconds; 100% means one core. The panel is read-only and refreshes every 10 seconds.

## Configuration

See [backend settings](backend/app/config.py) and both `.env.example` files.

| Backend variable | Default / meaning |
|---|---|
| `LCC_ADMIN_USERNAME`, `LCC_ADMIN_PASSWORD` | First-user bootstrap; default username `admin`, random password when empty |
| `LCC_DATABASE_URL` | SQLite under `backend/data/lcc.db` |
| `LCC_ALLOWED_ORIGINS` | JSON list; localhost/127.0.0.1 on port 3000 by default |
| `LCC_SSH_KEY_DIRS` | JSON list of allowed private-key directories, default `["~/.ssh"]` |
| `LCC_SSH_KNOWN_HOSTS` | `auto`, `ignore`, or explicit known_hosts path; verify hosts before use |
| `LCC_METRICS_INTERVAL_S` | 2 seconds |
| `LCC_SCHEDULER_INTERVAL_S` | 5 seconds |
| `LCC_GPU_FREE_MAX_MEM_FRAC` | Idle threshold: VRAM usage ≤0.10 |
| `LCC_GPU_FREE_MAX_UTIL` | Idle threshold: GPU utilization ≤15% |
| `LCC_DEMO_MODE` | Code default `true`; example env sets `false` |
| `LCC_COOKIE_SECURE` | Default `false` for local HTTP; configure for HTTPS deployment |

Frontend env: `LCC_BACKEND_URL` is the server-side REST proxy target;
`NEXT_PUBLIC_LCC_WS_PORT` is the browser-facing backend port (default 8600);
`LCC_DEV_ORIGINS` allows additional development-server hosts. AI credentials can
be set in Settings or via backend env variables.

## Data, logs and backups

| Location | Contents |
|---|---|
| `backend/data/lcc.db` | Password hashes, servers, jobs and transfer records |
| `backend/data/secret_key` | Session signing secret |
| `backend/data/ai_api_key`, `ai_config.json` | Locally configured AI provider credentials/settings |
| `backend/data/backups/` | Local database backups, if created |
| `logs/` | Timestamped launcher stdout/stderr |
| `frontend/logs/access-YYYY-MM-DD.jsonl` | UTC request time, socket peer, path, status and User-Agent |
| Remote `~/.lcc/jobs/<id>/` | Job script, stdout/stderr, PID, exit status and optional progress |

Training artifacts use the output paths configured in your command. Use SQLite's
backup facility for a running database, or stop the backend before copying it;
copying only a live `.db` can miss WAL changes. All data/env/log files are private
and ignored by Git, but **not** automatically excluded from manual ZIP archives.

Access files stop growing at 10 MiB per UTC day; console output continues. Old files
are not removed automatically. Queries, cookies and bodies are not logged. Forwarded
IP headers are diagnostic, not trusted identity. WebSockets are not in access logs.
The access logger/scan filter requires `npm run dev` or `npm start`; invoking `next`
directly bypasses the launcher. This filter is not a WAF or an authentication gate.

## Validation

```sh
cd backend
uv run python -m unittest discover -s tests
cd ../frontend
npm run typecheck
node --test scripts/request-guard.test.cjs scripts/jobs-bulk-delete.test.cjs
```

Build with `npm run build`, then serve with `npm start`. Do not build into the same
`.next` directory as a running dev server. Public deployment additionally needs a
considered HTTPS/reverse-proxy/WebSocket, authentication and firewall configuration.
The LAN launcher is not a public hosting setup.

## Current limits

- Scheduling uses sampled metrics and cooperative reservations, not system-wide
  GPU locks; manually launched processes can compete for the same cards.
- No token approval, MFA, login rate limiting, notifications or full user-management UI.
- The unified Logs page is a placeholder; job logs and access files are separate.
- SQLite upgrades use additive startup migrations. Other database engines need their
  driver and a migration plan; portability is not a tested deployment guarantee.
- Demo mode seeds an empty server database; simulated hosts cannot run real jobs or
  provide real files, quotas or process reports.

Read [SECURITY.md](SECURITY.md) before exposing an instance outside a trusted environment.
