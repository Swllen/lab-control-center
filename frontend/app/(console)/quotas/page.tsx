"use client";

import { useQuery } from "@tanstack/react-query";
import { HardDrive, RefreshCw } from "lucide-react";
import { useState } from "react";
import { ServerPicker } from "@/components/hardware/server-picker";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState, ProgressBar, Skeleton } from "@/components/ui/misc";
import { api, ApiError } from "@/lib/api/client";
import { formatBytes } from "@/lib/format";
import { useMe, useServers } from "@/lib/hooks/queries";

interface QuotaEntry {
  uid: number; username: string; filesystem: string;
  used_bytes: number; soft_bytes: number; hard_bytes: number; grace_expires: number | null;
  files_used: number; files_soft: number; files_hard: number; files_grace_expires: number | null;
}
interface QuotaReport {
  state: string; checked_at: string; entries: QuotaEntry[]; message: string | null; setup_command: string | null;
}
const limit = (n: number) => n ? formatBytes(n) : "Unlimited";
const ratio = (e: QuotaEntry) => {
  const bytes = e.hard_bytes || e.soft_bytes;
  const files = e.files_hard || e.files_soft;
  return Math.max(bytes ? e.used_bytes / bytes : 0, files ? e.files_used / files : 0);
};
function status(e: QuotaEntry) {
  if ((e.hard_bytes > 0 && e.used_bytes >= e.hard_bytes) || (e.files_hard > 0 && e.files_used >= e.files_hard)) return "Hard limit reached";
  if ((e.soft_bytes > 0 && e.used_bytes > e.soft_bytes) || (e.files_soft > 0 && e.files_used > e.files_soft)) return "Over soft limit";
  return ratio(e) >= 0.9 ? "Near limit" : "OK";
}
function grace(n: number | null) {
  if (!n) return "—";
  return `${n * 1000 <= Date.now() ? "Expired: " : "Until: "}${new Date(n * 1000).toLocaleString()}`;
}

function Quotas({ serverId }: { serverId: number }) {
  const [search, setSearch] = useState("");
  const [filesystem, setFilesystem] = useState("");
  const query = useQuery({ queryKey: ["quotas", serverId], queryFn: () => api<QuotaReport>(`/api/servers/${serverId}/quotas`), staleTime: 30_000, refetchInterval: 60_000, retry: false });
  const report = query.data;
  const entries = report?.entries ?? [];
  const rows = entries.filter(e => (!filesystem || e.filesystem === filesystem) && `${e.username} ${e.uid}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => ratio(b) - ratio(a) || b.used_bytes - a.used_bytes);
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-[13px] text-muted">{report ? `Checked ${new Date(report.checked_at).toLocaleString()} · refreshes every minute` : "Reading system quota records…"}</p>
      <Button size="sm" disabled={query.isFetching} onClick={() => void query.refetch()}><RefreshCw className={query.isFetching ? "animate-spin" : ""} /> Refresh</Button>
    </div>
    {query.error ? <GlassCard className="p-5 text-danger" role="alert">{query.error instanceof ApiError && query.error.status === 404 ? "The quota API is not loaded yet. Restart the backend once when it is safe to disconnect plain-shell terminals." : query.error.message}</GlassCard> : null}
    {query.isLoading ? <Skeleton className="h-60 w-full rounded-2xl" /> : null}
    {report && report.state !== "ready" ? <GlassCard className="space-y-3 p-6">
      <h2 className="font-semibold">{report.state === "permission_required" ? "Permission needed to read all users" : "Quota report unavailable"}</h2>
      <p className="text-sm text-muted">{report.message}</p>
      {report.setup_command ? <>
        <p className="text-sm text-muted">An administrator can allow the SSH account to run only this read-only report through sudo. No full sudo access is needed.</p>
        <pre className="overflow-x-auto rounded-xl bg-track p-3 text-xs">{report.setup_command}</pre>
        <p className="text-xs text-muted">See docs/QUOTAS.md for setup. No permissions or quotas are changed by this page.</p>
      </> : null}
    </GlassCard> : null}
    {report?.state === "ready" ? <>
      {report.message && entries.length > 0 ? <p className="text-sm text-muted">{report.message}</p> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        {[ ["Users", new Set(entries.map(e => e.uid)).size.toString()], ["Accounted usage", formatBytes(entries.reduce((n, e) => n + e.used_bytes, 0))], ["Needs attention", entries.filter(e => status(e) !== "OK").length.toString()] ].map(([label, value]) => <GlassCard key={label} className="p-5"><p className="text-xs text-muted">{label}</p><p className="mt-2 text-2xl font-semibold tabular">{value}</p></GlassCard>)}
      </div>
      <GlassCard className="overflow-hidden">
        <div className="flex flex-wrap gap-3 p-4">
          <Input aria-label="Search user or UID" placeholder="Search user or UID…" value={search} onChange={e => setSearch(e.target.value)} className="max-w-xs" />
          <select aria-label="Filesystem" className="rounded-xl border border-line bg-tile px-3 text-sm" value={filesystem} onChange={e => setFilesystem(e.target.value)}><option value="">All filesystems</option>{[...new Set(entries.map(e => e.filesystem))].map(fs => <option key={fs}>{fs}</option>)}</select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-track text-xs text-muted"><tr>{["User / filesystem", "Used", "Soft limit", "Hard limit", "Usage", "Files / soft / hard", "Status / grace"].map(label => <th key={label} className="whitespace-nowrap px-4 py-3 font-medium">{label}</th>)}</tr></thead>
            <tbody>{rows.map(e => {
              const label = status(e);
              const bytesLimit = e.hard_bytes || e.soft_bytes;
              const percent = bytesLimit ? e.used_bytes / bytesLimit * 100 : null;
              const tone = label === "Hard limit reached" ? "danger" : label !== "OK" ? "warning" : "success";
              return <tr key={`${e.uid}:${e.filesystem}`} className="border-t border-line">
                <td className="px-4 py-3"><p className="font-semibold">{e.username} <span className="font-normal text-muted">#{e.uid}</span></p><p className="text-xs text-muted">{e.filesystem}</p></td>
                <td className="px-4 py-3 tabular whitespace-nowrap">{formatBytes(e.used_bytes)}</td>
                <td className="px-4 py-3 tabular whitespace-nowrap">{limit(e.soft_bytes)}</td>
                <td className="px-4 py-3 tabular whitespace-nowrap">{limit(e.hard_bytes)}</td>
                <td className="min-w-32 px-4 py-3">{percent == null ? <span className="text-muted">No byte limit</span> : <><p className="mb-1 text-xs tabular">{percent.toFixed(1)}%</p><ProgressBar value={percent} tone={tone} /></>}</td>
                <td className="px-4 py-3 tabular whitespace-nowrap">{e.files_used.toLocaleString()} / {e.files_soft ? e.files_soft.toLocaleString() : "∞"} / {e.files_hard ? e.files_hard.toLocaleString() : "∞"}</td>
                <td className="px-4 py-3"><span className={tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-success"}>{label}</span>{e.grace_expires ? <p className="text-xs text-muted">Space: {grace(e.grace_expires)}</p> : null}{e.files_grace_expires ? <p className="text-xs text-muted">Files: {grace(e.files_grace_expires)}</p> : null}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
        {!rows.length ? <EmptyState icon={<HardDrive />} title="No quota records" description={entries.length ? "No users match the filter." : report.message ?? "No records returned."} /> : null}
      </GlassCard>
      <p className="text-xs text-muted">Usage is charged to each file owner on each filesystem, including files outside their home directory. Zero limits mean unlimited. Records are sorted by proximity to a space or file-count limit.</p>
    </> : null}
  </div>;
}

export default function QuotasPage() {
  const { data: user } = useMe();
  const { data: servers, isLoading } = useServers();
  const [selection, setSelection] = useState<number | null>(null);
  const sshServers = servers?.filter(s => s.transport === "ssh") ?? [];
  const selected = sshServers.find(s => s.id === selection)?.id ?? sshServers[0]?.id;
  if (user && user.role !== "admin") return <GlassCard><EmptyState icon={<HardDrive />} title="Administrator access required" description="Only administrators can read all users’ quota reports." /></GlassCard>;
  if (isLoading || !user) return <Skeleton className="h-60 rounded-2xl" />;
  if (!selected) return <GlassCard><EmptyState icon={<HardDrive />} title="No SSH servers" description="Add a real SSH server to view disk quotas." /></GlassCard>;
  return <div className="flex flex-col gap-5"><ServerPicker servers={sshServers} value={selected} onChange={setSelection} /><Quotas key={selected} serverId={selected} /></div>;
}
