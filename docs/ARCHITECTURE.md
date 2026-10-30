# Architecture

## Topology

```text
Browser -- HTTP :3000 --> Next.js -- /api proxy --> FastAPI :8600
   +------- WebSockets / large file streams ----------+
                                                       |
                                                  SSH / SFTP
                                                       |
                                                Linux GPU servers
```

The browser does not connect to remote SSH servers directly. The backend owns SSH
connections/keys, PTYs, SFTP clients, telemetry and the scheduler. Next also implements
an admin-protected `/api/lan-addresses` route which authenticates against the backend
before returning the control-center host's private IPv4 addresses.

## Components

| Service | Responsibility |
|---|---|
| `ssh_manager.py` | SSH pool, connection tests, configured known_hosts policy |
| `remote_probe.py` | Streamed remote Python telemetry; optional NVML with nvidia-smi fallback |
| `metrics_collector.py` | One collector per server, in-memory history and bounded WebSocket fan-out |
| `terminal_manager.py` | PTYs, replay buffers, plain shells, optional tmux and reattach |
| `sftp_manager.py` | Remote directory/file operations and streaming access |
| `transfer_manager.py` | Transfer lifecycle and progress |
| `job_scheduler.py` | Placement, detached launch, process polling and cancellation |
| `quota_probe.py` | Read-only repquota XML collection; no directory-size scan |
| `process_probe.py` | ps snapshots and short-interval CPU sampling from /proc |

Features normally share an SSH transport with separate channels. Some terminal
operations use a dedicated connection when channel capacity is exhausted. A shared
transport failure may therefore affect several features at once.

## Persistence and migrations

SQLAlchemy async models store users, servers, jobs, sweeps and transfers. SQLite
under `backend/data/` is the default. Metrics history, terminal buffers, subscribers
and short-lived report caches are in memory.

`create_schema()` creates tables and applies selected additive SQLite column
migrations at startup. It is not a general migration framework. Other database
engines require their async driver and a separate schema migration plan.

A job's `requested_gpu_indices` stores optional pinned physical indices; NULL means
automatic placement. `gpu_indices` stores actual assigned cards. Existing records
migrate with a NULL request. Retry resets assignment/results but retains the request;
duplicate and sweep creation retain it too.

## Job placement

The scheduler excludes cards assigned to running control-center jobs and checks
live telemetry. Defaults: memory usage at most 10%, GPU utilization at most 15%,
5-second scheduling interval. Each server also has a concurrent-job limit.

Placement is FIFO with backfill: a waiting task does not block later tasks that fit
other available resources. Pinned jobs require all selected cards to exist and be
free, never substitute another card, and remove their assignment from that tick's
available pool. The API validates duplicate/negative indices, count consistency and
known GPU inventory. CUDA_VISIBLE_DEVICES controls visibility, not OS-level ownership.

Jobs run via remote `setsid -f` scripts under `~/.lcc/jobs/<id>/`. PID, stdout/stderr
and exit status stay on that server. Canceling a job differs from deleting history.
Bulk deletion uses the existing guarded DELETE endpoint with bounded concurrency
and partial-failure reporting; it does not remove remote output.

## API and authorization

Signed HttpOnly cookies identify web users. Dependencies enforce viewer/operator/admin
roles. Mutating requests with disallowed Origin are rejected; WebSockets validate
Origin and the session. Web roles do not change the remote SSH login's Linux UID.

| Endpoint group | Purpose |
|---|---|
| `/api/auth/*` | Login/logout, identity and profile updates |
| `/api/servers/*` | Server CRUD/test/power, metrics, SFTP, previews and file streams |
| `/api/servers/{id}/quotas` | Admin-only report with 30-second cache |
| `/api/servers/{id}/processes` | Admin-only snapshot with 5-second cache |
| `/api/terminals/*`, `/ws/terminals/{id}` | Shell/tmux lifecycle, history and I/O |
| `/api/jobs/*`, `/api/sweeps/*`, `/api/scheduler/status` | Job history/control and scheduling |
| `/api/transfers/*`, `/ws/transfers` | Transfers and progress |
| `/ws/servers/{id}/metrics` | Streaming metrics |

`/docs` and `/openapi.json` describe the backend API. `/api/health` is public.
See [SECURITY.md](../SECURITY.md) for boundaries, including the known_hosts fallback
and the absence of MFA, token approval and login rate limiting.

## Frontend and launchers

Next.js App Router, React, TanStack Query, Radix and Tailwind provide the interface.
xterm.js implements terminals; SVG/CSS implements gauges and mascots. Files render
a visible row window; the process panel paginates snapshots.

`start.cmd` / `start-lan.cmd` invoke `scripts/start.ps1`. Local mode binds missing
services to 127.0.0.1; LAN mode binds them to 0.0.0.0 and adds detected private IPv4
origins for that launch. Existing services are reused, not restarted or reconfigured.
No firewall rule is changed.

`frontend/scripts/serve.cjs` preloads a Node HTTP request logger/filter before Next.
It records the actual peer address, treats forwarded headers as untrusted, omits
query strings/cookies/bodies, and bounds daily access-file growth. The narrow filter
blocks obvious non-app scanner paths but is not a WAF, rate limiter or auth gate.
