import type {
  ConnectionTestResult,
  DirListing,
  FilePreview,
  Job,
  JobSpec,
  LogTail,
  ServerQueueStatus,
  SweepPreview,
  PowerActionName,
  Server,
  ServerCreate,
  ServerMetrics,
  ServerUpdate,
  SSHConfigHost,
  TerminalAccount,
  TerminalSession,
  TmuxSessionList,
  Transfer,
  User,
} from "@/lib/types";
import { api, backendUrl } from "./client";

export { ApiError, backendUrl, wsUrl } from "./client";

export const authApi = {
  me: () => api<User>("/api/auth/me"),
  login: (username: string, password: string) =>
    api<User>("/api/auth/login", { method: "POST", body: { username, password } }),
  logout: () => api<void>("/api/auth/logout", { method: "POST" }),
};

export const serversApi = {
  list: () => api<Server[]>("/api/servers"),
  get: (id: number) => api<Server>(`/api/servers/${id}`),
  create: (body: ServerCreate) => api<Server>("/api/servers", { method: "POST", body: { ...body } }),
  update: (id: number, body: ServerUpdate) =>
    api<Server>(`/api/servers/${id}`, { method: "PATCH", body: { ...body } }),
  sshConfigHosts: () => api<SSHConfigHost[]>("/api/servers/ssh-config"),
  importSshConfig: (aliases: string[]) =>
    api<Server[]>("/api/servers/ssh-config/import", { method: "POST", body: { aliases } }),
  remove: (id: number) => api<void>(`/api/servers/${id}`, { method: "DELETE" }),
  test: (id: number) => api<ConnectionTestResult>(`/api/servers/${id}/test`, { method: "POST" }),
  testUnsaved: (body: Pick<ServerCreate, "hostname" | "port" | "username" | "key_path" | "transport">) =>
    api<ConnectionTestResult>("/api/servers/test", { method: "POST", body: { ...body } }),
  power: (id: number, action: PowerActionName, confirm: string) =>
    api<{ status: string }>(`/api/servers/${id}/power`, { method: "POST", body: { action, confirm } }),
};

export const terminalsApi = {
  list: () => api<TerminalSession[]>("/api/terminals"),
  accounts: () => api<TerminalAccount[]>("/api/terminals/accounts"),
  create: (body: {
    server_id: number;
    name: string;
    cols: number;
    rows: number;
    account?: string | null;
    tmux?: boolean;
    tmux_session?: string | null;
  }) => api<TerminalSession>("/api/terminals", { method: "POST", body }),
  rename: (id: string, name: string) => api<TerminalSession>(`/api/terminals/${id}`, { method: "PATCH", body: { name } }),
  /** Closing a tmux terminal only detaches from it unless `killTmux` is set. */
  close: (id: string, killTmux = false) =>
    api<void>(`/api/terminals/${id}${killTmux ? "?kill_tmux=true" : ""}`, { method: "DELETE" }),
  tmuxSessions: (serverId: number, account: string | null, all = false) =>
    api<TmuxSessionList>(`/api/terminals/tmux?${tmuxQuery(serverId, account, { all: all ? "true" : "" })}`),
  killTmux: (serverId: number, account: string | null, name: string) =>
    api<void>(`/api/terminals/tmux?${tmuxQuery(serverId, account, { name })}`, { method: "DELETE" }),
};

function tmuxQuery(serverId: number, account: string | null, extra: Record<string, string>): URLSearchParams {
  const q = new URLSearchParams({ server_id: String(serverId) });
  if (account) q.set("account", account);
  for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
  return q;
}

export const metricsApi = {
  summary: () => api<ServerMetrics[]>("/api/metrics/summary"),
};

export const jobsApi = {
  list: (params: { limit?: number; server_id?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.limit) q.set("limit", String(params.limit));
    if (params.server_id) q.set("server_id", String(params.server_id));
    return api<Job[]>(`/api/jobs?${q}`);
  },
  get: (id: number) => api<Job>(`/api/jobs/${id}`),
  create: (body: JobSpec & { name: string }) => api<Job>("/api/jobs", { method: "POST", body: { ...body } }),
  cancel: (id: number) => api<Job>(`/api/jobs/${id}/cancel`, { method: "POST" }),
  retry: (id: number) => api<Job>(`/api/jobs/${id}/retry`, { method: "POST" }),
  duplicate: (id: number) => api<Job>(`/api/jobs/${id}/duplicate`, { method: "POST" }),
  remove: (id: number) => api<void>(`/api/jobs/${id}`, { method: "DELETE" }),
  logs: (id: number, stream: "stdout" | "stderr", tailBytes = 65536) =>
    api<LogTail>(`/api/jobs/${id}/logs?stream=${stream}&tail_bytes=${tailBytes}`),
  queueStatus: () => api<ServerQueueStatus[]>("/api/scheduler/status"),
};

export const sweepsApi = {
  preview: (body: JobSpec & { name: string; parameters_yaml: string }) =>
    api<SweepPreview>("/api/sweeps/preview", { method: "POST", body: { ...body } }),
  create: (body: JobSpec & { name: string; parameters_yaml: string }) =>
    api<Job[]>("/api/sweeps", { method: "POST", body: { ...body } }),
};

export const transfersApi = {
  list: (limit = 50) => api<Transfer[]>(`/api/transfers?limit=${limit}`),
  copy: (body: { source_server_id: number; source_path: string; dest_server_id: number; dest_dir: string }) =>
    api<Transfer>("/api/transfers", { method: "POST", body }),
  cancel: (id: number) => api<Transfer>(`/api/transfers/${id}/cancel`, { method: "POST" }),
  retry: (id: number) => api<Transfer>(`/api/transfers/${id}/retry`, { method: "POST" }),
  clearFinished: () => api<void>("/api/transfers", { method: "DELETE" }),
};

const enc = encodeURIComponent;

export const filesApi = {
  list: (serverId: number, path: string) => api<DirListing>(`/api/servers/${serverId}/files?path=${enc(path)}`),
  mkdir: (serverId: number, path: string) =>
    api<{ path: string }>(`/api/servers/${serverId}/files/mkdir`, { method: "POST", body: { path } }),
  rename: (serverId: number, path: string, newPath: string) =>
    api<{ path: string }>(`/api/servers/${serverId}/files/rename`, { method: "POST", body: { path, new_path: newPath } }),
  remove: (serverId: number, paths: string[]) =>
    api<void>(`/api/servers/${serverId}/files/delete`, { method: "POST", body: { paths, confirm: true } }),
  downloadUrl: (serverId: number, path: string) => backendUrl(`/api/servers/${serverId}/download?path=${enc(path)}`),
  /** The first `maxBytes` of a file (server default 1 MiB), decoded when it looks like text. */
  preview: (serverId: number, path: string, maxBytes?: number) =>
    api<FilePreview>(`/api/servers/${serverId}/preview?path=${enc(path)}${maxBytes ? `&max_bytes=${maxBytes}` : ""}`),
  /** Inline image URL for the preview panel (images only, capped at 25 MB, not tracked as a transfer). */
  previewRawUrl: (serverId: number, path: string) => backendUrl(`/api/servers/${serverId}/preview/raw?path=${enc(path)}`),
  uploadUrl: (serverId: number, dir: string, name: string, overwrite = false) =>
    backendUrl(`/api/servers/${serverId}/upload?dir=${enc(dir)}&name=${enc(name)}${overwrite ? "&overwrite=true" : ""}`),
};

export const queryKeys = {
  me: ["me"] as const,
  servers: ["servers"] as const,
  summary: ["metrics", "summary"] as const,
  jobs: (limit?: number) => ["jobs", { limit }] as const,
  transfers: (limit?: number) => ["transfers", { limit }] as const,
  files: (serverId: number, path: string) => ["files", serverId, path] as const,
  // Nested under ["files", serverId] so refreshing a folder also refreshes an open preview.
  filePreview: (serverId: number, path: string) => ["files", serverId, "preview", path] as const,
};
