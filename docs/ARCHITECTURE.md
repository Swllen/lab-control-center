# Lab Server Control Center — Architecture

A single-host web control plane for a handful of Linux GPU servers used for AI
research. The browser never talks to the servers directly: the **backend owns
every SSH/SFTP connection**, and the frontend talks only to the backend.

```
 Browser (Next.js)                       Control-center host (FastAPI)                    Lab servers
┌──────────────────────┐   REST /api/*  ┌──────────────────────────────────┐   SSH      ┌──────────────────┐
│ Dashboard / Servers  │ ─────────────▶ │ api/*  (auth, validation)        │ ────────▶ │ sshd             │
│ Hardware / Jobs ...  │                │   │                              │           │  ├ probe (python)│
│                      │   WS /ws/*     │ services/                        │  1 conn   │  ├ pty shells    │
│ xterm.js (Phase 2)   │ ◀────────────▶ │   ssh_manager   (conn pool)      │  per      │  ├ sftp          │
│ file manager (Ph. 3) │                │   metrics_collector (hub)        │  server,  │  └ job runner    │
└──────────────────────┘                │   terminal_manager (Phase 2)     │  many     └──────────────────┘
                                        │   sftp/transfer_manager (Ph. 3)  │  channels
                                        │   job_scheduler (Phase 4)        │
                                        │ db/ SQLAlchemy async → SQLite    │
                                        └──────────────────────────────────┘
```

## Key decisions

| Decision | Why |
|---|---|
| **Agentless monitoring via a streamed probe.** On connect, the backend opens one long-lived SSH exec channel running `python3 -u -` and pipes a small, self-contained probe script ([`remote_probe.py`](../backend/app/services/remote_probe.py)) into stdin. The probe prints one JSON line per interval. | Nothing has to be installed on the servers. One persistent channel is far cheaper than spawning `nvidia-smi` every 2 s, and rate metrics (CPU %, network bps) are computed from deltas inside the probe. It uses `/proc`, `os.statvfs`, and **pynvml when available**, with a fallback to `nvidia-smi --query-gpu`. It's compatible with Python ≥ 3.6 on the remote side. |
| **One SSH connection per server, multiplexed.** `SSHManager` caches an `asyncssh` connection per server; metrics, terminals, SFTP, and jobs open *channels* on it. | Avoids repeated handshakes, keeps `MaxSessions` usage predictable, and gives one place to handle reconnects and host-key policy. |
| **MetricsHub = poll once, fan out to many.** Each server has a single collector task. Snapshots go into a ring buffer (history for sparklines) and are broadcast to per-subscriber bounded queues. | N browser tabs cost the servers nothing extra. Slow WebSocket clients drop stale frames instead of building up backpressure. The Phase 4 scheduler reads the same in-memory snapshots to decide GPU availability. |
| **Pluggable metric sources** (`SSHProbeSource`, `DemoSource`). | `transport = "demo"` servers produce realistic synthetic data, so the UI can be developed and shown without real hardware. |
| **SQLAlchemy 2.0 async + portable types only** (`String`, `Integer`, `JSON`, `DateTime(timezone=True)`). `DATABASE_URL` is configured from the environment. | Switching to PostgreSQL means changing `sqlite+aiosqlite://` to `postgresql+asyncpg://` and adding Alembic migrations. There is no SQLite-specific SQL. |
| **Keys stay on the host.** A server stores only a `key_path` (for example `~/.ssh/id_ed25519`), and it must resolve inside `SSH_KEY_DIRS`. Responses never include key material, and if `key_path` is empty, the SSH agent is used. | Meets the "never expose keys" requirement and stops the API from being used to read arbitrary files as keys. |
| **Host-key verification** uses `~/.ssh/known_hosts` by default (`SSH_KNOWN_HOSTS=auto`). | Secure by default. `ignore` exists only for lab networks with re-imaged machines and is logged loudly. |
| **Auth scaffolding**: a local admin user (scrypt-hashed password), a signed HttpOnly session cookie (`itsdangerous`), `User.role`, and a `require_role()` dependency. WebSockets authenticate with the same cookie and check `Origin`. | It works now with a single admin and supports RBAC later without changing the API shape. |
| **REST goes through Next rewrites (`/api/*`). WebSockets connect straight to the backend.** | REST cookies stay first-party. WebSocket upgrades through the Next dev proxy are unreliable. `localhost:3000` and `localhost:8000` are the same *site*, so `SameSite=Lax` cookies still reach the WebSocket. |
| **Terminals (Phase 2)**: `TerminalSession` wraps an asyncssh PTY channel behind a `TerminalBackend` protocol. `ShellBackend` runs the login shell; `TmuxBackend` (opt-in per terminal, `tmux: true`) runs `tmux new-session -A -s lcc-<id>` under `sh -c`, falling back to the login shell when tmux is not installed. | A plain shell survives page refreshes through the scrollback buffer but dies with the backend or the idle reaper. Under tmux, closing the PTY only detaches, so the shell outlives backend restarts; the pane remembers its tmux session name and re-creating it reattaches. Closing a tmux terminal asks whether to keep or kill the session, and `GET /api/terminals/tmux` lists `lcc-*` (or all) sessions per login for reattaching. |
| **Scheduler (Phase 4)** sits behind a `Scheduler` protocol. `LocalGpuScheduler` places queued jobs using live MetricsHub GPU data, sets `CUDA_VISIBLE_DEVICES`, and respects `Server.max_jobs`. | A `SlurmScheduler` can implement the same protocol by mapping to `sbatch`/`squeue`/`scancel`. |
| **Frontend**: Next.js App Router, TanStack Query for REST, a typed WebSocket hook with reconnect/backoff, shadcn-style primitives (Radix + cva), custom SVG gauges and sparklines. | SVG gauges are tiny, precisely styled to the reference, and render many times per second without chart-library overhead. |

## Directory structure

```
lab-control-center/
├── docs/ARCHITECTURE.md
├── backend/                         # uv project (Python 3.12)
│   ├── pyproject.toml / uv.lock
│   └── app/
│       ├── main.py                  # app factory + lifespan (DB, hub start/stop)
│       ├── config.py                # pydantic-settings, env prefix LCC_
│       ├── core/
│       │   ├── security.py          # password hashing, session tokens
│       │   ├── deps.py              # current_user / require_role / ws auth
│       │   └── paths.py             # remote path sanitizing, key path checks
│       ├── db/
│       │   ├── base.py  session.py  init_db.py
│       ├── models/                  # SQLAlchemy ORM
│       │   ├── user.py server.py job.py transfer.py
│       ├── schemas/                 # Pydantic I/O contracts
│       │   ├── auth.py server.py metrics.py job.py transfer.py
│       ├── api/
│       │   ├── auth.py servers.py metrics.py jobs.py transfers.py
│       │   └── (Phase 2+) terminals.py files.py
│       └── services/
│           ├── ssh_manager.py       # connection pool, connect/test
│           ├── remote_probe.py      # remote probe (shipped over stdin)
│           ├── metrics_collector.py # MetricsHub, collectors, fan-out
│           ├── demo_source.py       # synthetic metrics
│           ├── server_actions.py    # reboot/poweroff
│           └── (Phase 2+) terminal_manager.py sftp_manager.py
│                          transfer_manager.py job_scheduler.py
└── frontend/
    ├── app/
    │   ├── layout.tsx  globals.css  providers.tsx
    │   ├── login/
    │   └── (console)/               # authenticated shell
    │       ├── layout.tsx
    │       ├── dashboard/ servers/ hardware/ terminals/ files/
    │       └── jobs/ transfers/ logs/ settings/
    ├── components/
    │   ├── layout/   (AppShell, Sidebar, Topbar, ScenicBackground, CommandPalette)
    │   ├── ui/       (shadcn-style primitives)
    │   ├── metrics/  (RingGauge, Sparkline, MetricTile, UsageBar)
    │   ├── server/   (ServerCard, ServerForm, PowerDialog, ...)
    │   ├── hardware/ jobs/ transfers/
    └── lib/
        ├── api/      (typed client per resource)
        ├── hooks/    (useServerMetrics, ...)
        ├── types.ts  format.ts  utils.ts
```

## Data models

**User**: `id, username (unique), password_hash, display_name, role ('admin'|'operator'|'viewer'), is_active, created_at`

**Server**: `id, name (unique), hostname, port=22, username, key_path?, transport ('ssh'|'demo'), tags: JSON[str], description, max_jobs=4, created_at, updated_at`

**Job**: `id, name, server_id → Server, sweep_id → Sweep?, working_dir, command, env: JSON{str:str}, gpus_requested, gpu_indices: JSON[int]? (assigned), status ('queued'|'running'|'completed'|'failed'|'canceled'), exit_code?, pid?, stdout_path, stderr_path, params: JSON (sweep point), created_at, started_at?, ended_at?`

**Sweep**: `id, name, template: JSON {command, working_dir, env, gpus, server_id}, parameters: JSON {name: [values]}, created_at`. The cartesian product of `parameters` expands into Jobs, with `{learning_rate}`-style placeholders substituted into the command.

**Transfer**: `id, direction ('upload'|'download'|'server_to_server'), filename, source_server_id?, source_path, dest_server_id?, dest_path, size_bytes?, transferred_bytes, status ('queued'|'transferring'|'completed'|'failed'|'canceled'), error?, created_at, started_at?, ended_at?`. Speed and ETA are computed live by the transfer manager and pushed over WebSocket.

**In-memory only**: `MetricsSnapshot` (CPU, memory, GPU[], disks[], net), `ServerStatic` (host info), and connection status. These are runtime state and never written to the DB.

## API design

All REST endpoints are under `/api` and require a session cookie unless marked public.

| Method | Path | Phase | Notes |
|---|---|---|---|
| POST | `/api/auth/login` | 1 | public, sets cookie |
| POST | `/api/auth/logout` | 1 | |
| GET | `/api/auth/me` | 1 | |
| GET / POST | `/api/servers` | 1 | |
| GET / PATCH / DELETE | `/api/servers/{id}` | 1 | DELETE requires admin |
| POST | `/api/servers/test` | 1 | tests an unsaved config |
| POST | `/api/servers/{id}/test` | 1 | |
| POST | `/api/servers/{id}/power` | 1 | `{action: reboot|poweroff, confirm: <server name>}` |
| GET | `/api/servers/{id}/metrics` | 1 | latest snapshot, static info, and status |
| GET | `/api/servers/{id}/metrics/history` | 1 | ring buffer |
| GET | `/api/metrics/summary` | 1 | every server's latest snapshot (sidebar, palette) |
| WS | `/ws/servers/{id}/metrics` | 1 | `hello{static,status,history}` then `snapshot` / `status` frames |
| POST | `/api/terminals` | 2 | `{server_id, name, cols, rows, account?, tmux?, tmux_session?}` → terminal (incl. `tmux` session name) |
| GET / DELETE | `/api/terminals[/{sid}]` | 2 | `DELETE ?kill_tmux=true` also kills the tmux session (default: detach) |
| GET / DELETE | `/api/terminals/tmux?server_id=&account=` | 2 | list (`&all=true` includes non-`lcc-*`) / kill (`&name=`) tmux sessions for that login |
| WS | `/ws/terminals/{sid}` | 2 | binary = pty data, text JSON = `{type:resize}` |
| GET | `/api/servers/{id}/files?path=` | 3 | list a directory |
| GET | `/api/servers/{id}/download?path=` | 3 | streamed, Range-capable |
| POST | `/api/servers/{id}/upload?path=` | 3 | streamed multipart, creates a Transfer |
| POST | `/api/servers/{id}/files/{mkdir,rename,move,delete}` | 3 | |
| GET | `/api/transfers` | 1 (read) / 3 | |
| POST | `/api/transfers` | 3 | server_to_server: `{source_server_id, source_path, dest_server_id, dest_path}` |
| POST | `/api/transfers/{id}/{cancel,retry}` | 3 | |
| WS | `/ws/transfers` | 3 | progress events |
| GET / POST | `/api/jobs` | 1 (read) / 4 | |
| POST | `/api/jobs/{id}/{cancel,retry,duplicate}` | 4 | |
| GET | `/api/jobs/{id}/logs?stream=stdout` | 4 | |
| POST | `/api/sweeps` | 4 | expands into Jobs |

## Implementation plan

1. **Phase 1 (done)**: scaffold, auth, server CRUD and connection test, SSH pool, probe-based metrics hub, metrics WebSocket, glass UI shell, dashboard, servers page, hardware page, demo servers.
2. **Phase 2 (done)**: `terminal_manager` (PTY channels and resize), xterm.js with the fit and webgl addons, tabs plus 1×1/1×2/2×2 split layouts saved to localStorage, reconnect/duplicate/maximize, optional tmux backend with reattach.
3. **Phase 3 (done)**: `sftp_manager` (chunked async reads and writes, never whole files), streaming download with `StreamingResponse`, streaming upload, transfer manager with progress, cancel, and retry.
4. **Phase 4 (done)**: Job/Sweep APIs, `LocalGpuScheduler` (nohup wrapper writing pid and exit code), log tailing.
5. **Phase 5**: logs page, notifications, preferences, polish.
