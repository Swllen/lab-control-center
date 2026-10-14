// Mirrors backend/app/schemas/*. Keep in sync when the API changes.

export type Transport = "ssh" | "demo";

export interface Server {
  id: number;
  name: string;
  hostname: string;
  port: number;
  username: string;
  key_path: string | null;
  /** ~/.ssh/config Host alias; when set, connection settings come from the config file. */
  ssh_config_host: string | null;
  transport: Transport;
  tags: string[];
  description: string;
  max_jobs: number;
  created_at: string;
  updated_at: string;
}

export interface ServerCreate {
  name: string;
  hostname: string;
  port: number;
  username: string;
  key_path: string | null;
  transport: Transport;
  tags: string[];
  description: string;
  max_jobs: number;
}

export interface SSHConfigHost {
  alias: string;
  hostname: string;
  user: string | null;
  port: number;
  identity_file: string | null;
  proxy_jump: string | null;
  imported_as: number | null;
}

export type ServerUpdate = Partial<Omit<ServerCreate, "transport">>;

export interface ConnectionTestResult {
  ok: boolean;
  latency_ms: number | null;
  error: string | null;
  hostname: string | null;
  os_name: string | null;
  kernel: string | null;
  python: string | null;
  has_nvidia_smi: boolean;
  has_pynvml: boolean;
  gpu_count: number;
}

export type PowerActionName = "reboot" | "poweroff";

// ---------------------------------------------------------------- metrics

export type ConnectionState = "connecting" | "online" | "offline" | "error";

export interface ServerStatus {
  state: ConnectionState;
  error: string | null;
  since: number;
}

export interface GpuStatic {
  index: number;
  name: string;
  uuid: string;
  memory_total: number;
  power_limit_w: number | null;
}

export interface NetInterfaceStatic {
  name: string;
  addresses: string[];
  mac: string;
  speed_mbps: number | null;
}

export interface ServerStatic {
  hostname: string;
  os_name: string;
  kernel: string;
  arch: string;
  cpu_model: string;
  cpu_cores: number;
  cpu_threads: number;
  mem_total: number;
  gpu_driver: string | null;
  cuda_version: string | null;
  gpu_backend: "pynvml" | "nvidia-smi" | "none";
  gpus: GpuStatic[];
  interfaces: NetInterfaceStatic[];
}

export interface GpuMetrics {
  index: number;
  utilization: number;
  memory_used: number;
  memory_total: number;
  temperature_c: number | null;
  power_w: number | null;
  power_limit_w: number | null;
  fan_percent: number | null;
  processes: number | null;
}

export interface DiskMetrics {
  mount: string;
  device: string;
  fstype: string;
  total: number;
  used: number;
  percent: number;
}

export interface NetInterfaceMetrics {
  name: string;
  rx_bps: number;
  tx_bps: number;
  rx_total: number;
  tx_total: number;
}

export interface MetricsSnapshot {
  ts: number;
  uptime_s: number;
  cpu: { percent: number; per_core: number[]; load: [number, number, number] };
  memory: {
    total: number;
    used: number;
    available: number;
    percent: number;
    swap_total: number;
    swap_used: number;
  };
  gpus: GpuMetrics[];
  disks: DiskMetrics[];
  net: { rx_bps: number; tx_bps: number; interfaces: NetInterfaceMetrics[] };
}

export interface ServerMetrics {
  server_id: number;
  status: ServerStatus;
  static: ServerStatic | null;
  latest: MetricsSnapshot | null;
}

export type MetricsFrame =
  | { type: "hello"; server_id: number; status: ServerStatus; static: ServerStatic | null; history: MetricsSnapshot[] }
  | { type: "snapshot"; snapshot: MetricsSnapshot }
  | { type: "status"; status: ServerStatus }
  | { type: "static"; static: ServerStatic };

// ---------------------------------------------------------------- jobs / transfers

export type JobStatus = "queued" | "running" | "completed" | "failed" | "canceled";

export interface Job {
  id: number;
  name: string;
  server_id: number;
  sweep_id: number | null;
  working_dir: string;
  command: string;
  env: Record<string, string>;
  params: Record<string, unknown>;
  gpus_requested: number;
  gpu_indices: number[] | null;
  status: JobStatus;
  progress: number | null;
  exit_code: number | null;
  error: string | null;
  pid: number | null;
  wait_reason: string | null;
  stdout_path: string | null;
  stderr_path: string | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
}

export interface JobSpec {
  server_id: number;
  working_dir: string;
  command: string;
  env: Record<string, string>;
  gpus: number;
}

export interface SweepPreview {
  count: number;
  parameters: Record<string, unknown[]>;
  jobs: { name: string; command: string; params: Record<string, unknown> }[];
}

export interface LogTail {
  job_id: number;
  stream: "stdout" | "stderr";
  path: string | null;
  size: number;
  offset: number;
  content: string;
  truncated: boolean;
}

export interface ServerQueueStatus {
  server_id: number;
  max_jobs: number;
  running: number;
  queued: number;
  gpu_count: number;
  gpus_in_use: number[];
  gpus_free: number[];
  online: boolean;
}

export type TransferStatus = "queued" | "transferring" | "completed" | "failed" | "canceled";
export type TransferDirection = "upload" | "download" | "server_to_server";

export interface Transfer {
  id: number;
  direction: TransferDirection;
  filename: string;
  is_directory: boolean;
  source_server_id: number | null;
  source_path: string;
  dest_server_id: number | null;
  dest_path: string;
  size_bytes: number | null;
  transferred_bytes: number;
  status: TransferStatus;
  error: string | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  speed_bps?: number | null;
  eta_s?: number | null;
}

export interface LiveTransfer {
  id: number;
  status: TransferStatus;
  transferred_bytes: number;
  size_bytes: number | null;
  speed_bps: number;
  eta_s: number | null;
}

// ---------------------------------------------------------------- files

export type FileType = "file" | "dir" | "symlink" | "other";

export interface FileEntry {
  name: string;
  path: string;
  type: FileType;
  size: number;
  mtime: number | null;
  mode: string;
  owner: string | null;
  group: string | null;
  link_target: string | null;
  target_type: FileType | null;
}

export interface DirListing {
  server_id: number;
  path: string;
  parent: string | null;
  home: string;
  entries: FileEntry[];
  truncated: boolean;
}

export interface FilePreview {
  path: string;
  name: string;
  size: number;
  mtime: number | null;
  kind: "text" | "binary";
  /** "utf-8", or "utf-8 (lossy)" when some bytes were not valid UTF-8. */
  encoding: string | null;
  content: string | null;
  bytes_read: number;
  /** Only the first `bytes_read` bytes of the file are included. */
  truncated: boolean;
}

// ---------------------------------------------------------------- terminals

export interface TerminalSession {
  id: string;
  server_id: number;
  server_name: string;
  name: string;
  account: string | null;
  username: string | null;
  /** tmux session name, or null for a plain login shell. */
  tmux: string | null;
  state: "starting" | "running" | "closed";
  exit_status: number | null;
  error: string | null;
  created_at: number;
  attached: number;
}

/** A login account for a server: its own login (primary) or another ~/.ssh/config alias for the same host. */
export interface TerminalAccount {
  server_id: number;
  account: string | null;
  username: string | null;
  primary: boolean;
}

export interface TmuxSession {
  name: string;
  /** Unix seconds. */
  created: number;
  /** tmux clients attached from anywhere, including control-center terminals. */
  attached: number;
  windows: number;
  /** Created by the control center (lcc-* prefix). */
  managed: boolean;
  /** Your open control-center terminals attached to it. */
  terminal_ids: string[];
}

export interface TmuxSessionList {
  server_id: number;
  account: string | null;
  /** False when tmux is not installed for this login. */
  available: boolean;
  sessions: TmuxSession[];
}

// ---------------------------------------------------------------- auth

export interface User {
  id: number;
  username: string;
  display_name: string;
  role: "admin" | "operator" | "viewer";
}
