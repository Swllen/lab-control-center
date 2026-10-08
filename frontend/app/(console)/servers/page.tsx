"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText, KeyRound, Pencil, Plug, Plus, Server as ServerIcon, Trash2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { toast } from "sonner";
import { ImportSshConfigDialog } from "@/components/server/import-ssh-config-dialog";
import { ServerFormDialog } from "@/components/server/server-form-dialog";
import { StatusBadge } from "@/components/server/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { queryKeys, serversApi } from "@/lib/api";
import { shortGpuName } from "@/lib/format";
import { useMetricsSummary, useServers } from "@/lib/hooks/queries";
import type { Server } from "@/lib/types";

function ServersPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const { data: servers, isLoading } = useServers();
  const { data: summary } = useMetricsSummary();
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<Server | null>(null);
  const [deleting, setDeleting] = useState<Server | null>(null);
  const [testingId, setTestingId] = useState<number | null>(null);

  useEffect(() => {
    if (params.get("new") === "1") {
      setEditing(null);
      setFormOpen(true);
      router.replace("/servers");
    }
  }, [params, router]);

  const metricsById = new Map((summary ?? []).map((m) => [m.server_id, m]));

  const test = useMutation({
    mutationFn: (s: Server) => {
      setTestingId(s.id);
      return serversApi.test(s.id);
    },
    onSuccess: (r, s) =>
      r.ok
        ? toast.success(`${s.name}: connected in ${r.latency_ms} ms`, { description: `${r.os_name} · ${r.gpu_count} GPU(s)` })
        : toast.error(`${s.name}: ${r.error}`),
    onError: (e) => toast.error(e.message),
    onSettled: () => setTestingId(null),
  });

  const remove = useMutation({
    mutationFn: (s: Server) => serversApi.remove(s.id),
    onSuccess: (_, s) => {
      toast.success(`Removed ${s.name}`);
      qc.invalidateQueries({ queryKey: queryKeys.servers });
      qc.invalidateQueries({ queryKey: queryKeys.summary });
      setDeleting(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const openNew = () => {
    setEditing(null);
    setFormOpen(true);
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <p className="text-[13.5px] text-muted">
          {servers ? `${servers.length} server${servers.length === 1 ? "" : "s"} configured` : " "}
        </p>
        <div className="flex gap-2.5">
          <Button onClick={() => setImportOpen(true)}><FileText /> Import from SSH config</Button>
          <Button variant="primary" onClick={openNew}><Plus /> Add server</Button>
        </div>
      </div>

      <GlassCard className="overflow-hidden">
        {isLoading ? (
          <div className="space-y-3 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}</div>
        ) : !servers?.length ? (
          <EmptyState
            icon={<ServerIcon />}
            title="No servers configured"
            description="Add a server with its hostname, SSH user and a key path on this machine. You can test the connection before saving."
            action={
              <div className="flex gap-2.5">
                <Button onClick={() => setImportOpen(true)}><FileText /> Import from SSH config</Button>
                <Button variant="primary" onClick={openNew}><Plus /> Add server</Button>
              </div>
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {servers.map((s) => {
              const m = metricsById.get(s.id);
              const gpus = m?.static?.gpus ?? [];
              return (
                <li key={s.id} className="flex flex-wrap items-center gap-x-6 gap-y-3 px-6 py-4 transition-colors hover:bg-tile/60">
                  <div className="flex min-w-[220px] flex-1 items-center gap-4">
                    <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-tile text-muted shadow-tile">
                      <ServerIcon className="size-5" strokeWidth={1.7} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2.5">
                        <p className="truncate text-[15px] font-semibold">{s.name}</p>
                        <StatusBadge state={m?.status.state} />
                        {s.transport === "demo" ? <Badge tone="info">Simulated</Badge> : null}
                      </div>
                      <p className="mt-0.5 truncate font-mono text-[12.5px] text-muted">
                        {s.ssh_config_host ? `ssh ${s.ssh_config_host} → ` : ""}{s.username}@{s.hostname}:{s.port}
                      </p>
                    </div>
                  </div>
                  <div className="min-w-[180px] text-[12.5px] text-muted">
                    <p className="flex items-center gap-1.5 truncate">
                      <KeyRound className="size-3.5" />
                      <span className="font-mono">{s.transport === "demo" ? "—" : s.ssh_config_host ? "~/.ssh/config" : s.key_path ?? "ssh-agent"}</span>
                    </p>
                    <p className="mt-1 truncate">
                      {gpus.length ? `${gpus.length} × ${shortGpuName(gpus[0]!.name)}` : m?.static ? "No GPU" : "—"} · max {s.max_jobs} jobs
                    </p>
                  </div>
                  <div className="flex min-w-[140px] flex-wrap gap-1.5">
                    {s.tags.map((t) => <Badge key={t} tone="neutral">{t}</Badge>)}
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    <Button size="sm" onClick={() => test.mutate(s)} loading={testingId === s.id}><Plug /> Test</Button>
                    <Button size="sm" onClick={() => { setEditing(s); setFormOpen(true); }}><Pencil /> Edit</Button>
                    <Button size="icon-sm" variant="ghost" aria-label={`Remove ${s.name}`} onClick={() => setDeleting(s)} className="hover:bg-danger-soft hover:text-danger">
                      <Trash2 />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </GlassCard>

      <ServerFormDialog open={formOpen} onOpenChange={setFormOpen} server={editing} />
      <ImportSshConfigDialog open={importOpen} onOpenChange={setImportOpen} />

      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader
            tone="danger"
            icon={<Trash2 />}
            title={`Remove ${deleting?.name}?`}
            description="This removes the server from the control center along with its job history. Nothing on the server itself is changed."
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="danger-solid" loading={remove.isPending} onClick={() => deleting && remove.mutate(deleting)}>
              Remove server
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function ServersPage() {
  return (
    <Suspense>
      <ServersPageInner />
    </Suspense>
  );
}
