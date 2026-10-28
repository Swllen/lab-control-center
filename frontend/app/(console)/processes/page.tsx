"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { ServerPicker } from "@/components/hardware/server-picker";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { api, ApiError } from "@/lib/api/client";
import { formatBytes, formatUptime } from "@/lib/format";
import { useMe, useServers } from "@/lib/hooks/queries";

interface ProcessEntry {
  pid: number; ppid: number; uid: number; username: string; state: string;
  cpu_percent: number | null; memory_percent: number; rss_bytes: number;
  elapsed_seconds: number; command: string; command_truncated: boolean;
}
interface ProcessReport { checked_at: string; ssh_user: string; entries: ProcessEntry[] }
type Sort = "cpu" | "memory" | "elapsed" | "pid";
const PAGE_SIZE = 100;

function ProcessTable({ serverId }: { serverId: number }) {
  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState("");
  const [state, setState] = useState("");
  const [sort, setSort] = useState<Sort>("cpu");
  const [page, setPage] = useState(0);
  const [auto, setAuto] = useState(true);
  const query = useQuery({
    queryKey: ["processes", serverId],
    queryFn: () => api<ProcessReport>(`/api/servers/${serverId}/processes`),
    staleTime: 5000, refetchInterval: auto ? 10_000 : false, retry: false,
  });
  const entries = query.data?.entries;
  const users = [...new Set((entries ?? []).map(p => p.username))].sort();
  const rows = useMemo(() => (entries ?? []).filter(p =>
    (!owner || p.username === owner) && (!state || p.state.startsWith(state)) &&
    `${p.pid} ${p.username} ${p.command}`.toLowerCase().includes(search.toLowerCase()),
  ).sort((a, b) => {
    if (sort === "memory") return b.rss_bytes - a.rss_bytes || a.pid - b.pid;
    if (sort === "elapsed") return b.elapsed_seconds - a.elapsed_seconds || a.pid - b.pid;
    if (sort === "pid") return a.pid - b.pid;
    return (b.cpu_percent ?? -1) - (a.cpu_percent ?? -1) || b.rss_bytes - a.rss_bytes;
  }), [entries, owner, state, search, sort]);
  const maxPage = Math.max(0, Math.ceil(rows.length / PAGE_SIZE) - 1);
  const current = Math.min(page, maxPage);
  const selectStyle = "h-9 rounded-xl border border-line bg-tile px-3 text-sm";

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted">{query.data ? `Checked ${new Date(query.data.checked_at).toLocaleString()} · SSH: ${query.data.ssh_user}` : "Reading process snapshot…"}</p>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} /> Refresh every 10s</label>
        <Button size="sm" disabled={query.isFetching} onClick={() => void query.refetch()}><RefreshCw className={query.isFetching ? "animate-spin" : ""} /> Refresh</Button>
      </div>
    </div>
    {query.error ? <GlassCard role="alert" className="p-5 text-danger">{query.error instanceof ApiError && query.error.status === 404 ? "The process API is not loaded yet. Restart the backend when it is safe to disconnect plain-shell terminals." : query.error.message}</GlassCard> : null}
    {query.isLoading ? <Skeleton className="h-72 rounded-2xl" /> : null}
    {entries ? <>
      <div className="grid gap-3 sm:grid-cols-3">{[
        ["Visible processes", entries.length], ["Users", users.length], ["Running now (R)", entries.filter(p => p.state.startsWith("R")).length],
      ].map(([label, value]) => <GlassCard key={label} className="p-5"><p className="text-xs text-muted">{label}</p><p className="mt-2 text-2xl font-semibold tabular">{value}</p></GlassCard>)}</div>
      <GlassCard className="overflow-hidden">
        <div className="flex flex-wrap gap-3 p-4">
          <Input className="max-w-sm" aria-label="Search process" placeholder="Search PID, user or command…" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} />
          <select className={selectStyle} aria-label="User" value={owner} onChange={e => { setOwner(e.target.value); setPage(0); }}><option value="">All users</option>{users.map(user => <option key={user}>{user}</option>)}</select>
          <select className={selectStyle} aria-label="Process state" value={state} onChange={e => { setState(e.target.value); setPage(0); }}><option value="">All states</option><option value="R">Running (R)</option><option value="S">Sleeping (S)</option><option value="D">Disk wait (D)</option><option value="T">Stopped (T)</option><option value="Z">Zombie (Z)</option><option value="I">Idle kernel (I)</option></select>
          <select className={selectStyle} aria-label="Sort processes" value={sort} onChange={e => { setSort(e.target.value as Sort); setPage(0); }}><option value="cpu">Highest CPU</option><option value="memory">Highest memory</option><option value="elapsed">Longest running</option><option value="pid">PID</option></select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-track text-xs text-muted"><tr>{["PID / parent", "User", "State", "CPU", "RAM (RSS)", "Elapsed", "Command"].map(label => <th key={label} className="whitespace-nowrap px-4 py-3 font-medium">{label}</th>)}</tr></thead>
            <tbody>{rows.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map(p => <tr key={p.pid} className="border-t border-line align-top hover:bg-tile-hover">
              <td className="px-4 py-3 tabular"><p>{p.pid}</p><p className="text-xs text-muted">PPID {p.ppid}</p></td>
              <td className="px-4 py-3"><p>{p.username}</p><p className="text-xs text-muted">UID {p.uid}</p></td>
              <td className="px-4 py-3 font-mono">{p.state}</td>
              <td className="px-4 py-3 tabular">{p.cpu_percent == null ? "—" : `${p.cpu_percent.toFixed(1)}%`}</td>
              <td className="whitespace-nowrap px-4 py-3 tabular"><p>{formatBytes(p.rss_bytes)}</p><p className="text-xs text-muted">{p.memory_percent.toFixed(1)}%</p></td>
              <td className="whitespace-nowrap px-4 py-3 tabular">{formatUptime(p.elapsed_seconds)}</td>
              <td className="min-w-72 max-w-xl px-4 py-3"><code className="block whitespace-pre-wrap break-all text-xs leading-relaxed">{p.command}{p.command_truncated ? "… (truncated)" : ""}</code></td>
            </tr>)}</tbody>
          </table>
        </div>
        {!rows.length ? <EmptyState icon={<Activity />} title="No matching processes" description="Try a different user, state or search term." /> : null}
        <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-xs text-muted">
          <span>{rows.length.toLocaleString()} processes · Page {current + 1} / {maxPage + 1}</span>
          <div className="flex gap-2"><Button size="sm" disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</Button><Button size="sm" disabled={current >= maxPage} onClick={() => setPage(current + 1)}>Next</Button></div>
        </div>
      </GlassCard>
      <p className="text-xs leading-relaxed text-muted">Shows processes visible to the SSH account, including sleeping jobs and system services. Server permissions may hide other users’ processes or command lines. CPU is sampled over roughly 0.5 seconds; 100% means one CPU core, so multithreaded jobs can exceed 100%. A dash means the process is new or its CPU data is inaccessible.</p>
    </> : null}
  </div>;
}

export default function ProcessesPage() {
  const { data: user } = useMe();
  const { data: servers, isLoading } = useServers();
  const [selection, setSelection] = useState<number | null>(null);
  const sshServers = servers?.filter(s => s.transport === "ssh") ?? [];
  const selected = sshServers.find(s => s.id === selection)?.id ?? sshServers[0]?.id;
  if (user && user.role !== "admin") return <GlassCard><EmptyState icon={<Activity />} title="Administrator access required" description="Process command lines are available to administrators only." /></GlassCard>;
  if (isLoading || !user) return <Skeleton className="h-60 rounded-2xl" />;
  if (!selected) return <GlassCard><EmptyState icon={<Activity />} title="No SSH servers" description="Add an SSH server to view processes." /></GlassCard>;
  return <div className="flex flex-col gap-5"><ServerPicker servers={sshServers} value={selected} onChange={setSelection} /><ProcessTable key={selected} serverId={selected} /></div>;
}
