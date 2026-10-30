"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Layers, Microchip, Plus, Search, Trash2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { toast } from "sonner";
import { JobDetailDialog } from "@/components/jobs/job-detail-dialog";
import { JobFormDialog, type JobFormInitial, type JobFormMode } from "@/components/jobs/job-form-dialog";
import { JobsTable } from "@/components/jobs/jobs-table";
import { StatusDot } from "@/components/server/status-badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { jobsApi } from "@/lib/api";
import { useMe, useServerMap, useServers } from "@/lib/hooks/queries";
import type { Job, JobStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const FILTERS: { id: "all" | JobStatus; label: string }[] = [
  { id: "all", label: "All" },
  { id: "queued", label: "Queued" },
  { id: "running", label: "Running" },
  { id: "completed", label: "Completed" },
  { id: "failed", label: "Failed" },
  { id: "canceled", label: "Canceled" },
];

function QueueStrip() {
  const servers = useServerMap();
  const { data } = useQuery({ queryKey: ["scheduler", "status"], queryFn: jobsApi.queueStatus, refetchInterval: 5000 });
  if (!data?.length) return null;
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 3xl:grid-cols-4">
      {data.map((q) => (
        <GlassCard key={q.server_id} className="flex items-center gap-4 px-5 py-4">
          <StatusDot state={q.online ? "online" : "offline"} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14.5px] font-semibold">{servers.get(q.server_id)?.name ?? `server ${q.server_id}`}</p>
            <p className="tabular text-[12.5px] text-muted">
              {q.running}/{q.max_jobs} running · {q.queued} queued
            </p>
          </div>
          <div className="flex items-center gap-1.5" title="GPU availability: green = idle, blue = used by a control-center job, grey = busy">
            <Microchip className="mr-1 size-4 text-muted" />
            {Array.from({ length: q.gpu_count }, (_, i) => (
              <span
                key={i}
                className={cn(
                  "grid size-6 place-items-center rounded-md text-[11px] font-semibold tabular",
                  q.gpus_free.includes(i) ? "bg-success-soft text-success" : q.gpus_in_use.includes(i) ? "bg-primary-soft text-primary" : "bg-track text-subtle",
                )}
              >
                {i}
              </span>
            ))}
            {q.gpu_count === 0 ? <span className="text-[12px] text-subtle">{q.online ? "no GPUs" : "offline"}</span> : null}
          </div>
        </GlassCard>
      ))}
    </div>
  );
}

function JobsPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { data: servers } = useServers();
  const { data: user } = useMe();
  const qc = useQueryClient();
  const canManage = user?.role === "admin" || user?.role === "operator";
  const jobs = useQuery({ queryKey: ["jobs", "page"], queryFn: () => jobsApi.list({ limit: 500 }), refetchInterval: 3000 });
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<number[]>([]);
  const [form, setForm] = useState<{ mode: JobFormMode; initial: JobFormInitial | null } | null>(null);
  const openJob = Number(params.get("job")) || null;

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const j of jobs.data ?? []) c[j.status] = (c[j.status] ?? 0) + 1;
    return c;
  }, [jobs.data]);

  const rows = (jobs.data ?? []).filter(
    (j) => (filter === "all" || j.status === filter) && (!query || `${j.name} ${j.command}`.toLowerCase().includes(query.toLowerCase())),
  );
  const deletable = rows.filter(job => ["completed", "failed", "canceled"].includes(job.status));
  const visibleSelection = new Set(deletable.filter(job => selected.has(job.id)).map(job => job.id));
  const removeJobs = useMutation({
    mutationFn: (ids: number[]) => jobsApi.removeMany(ids),
    onSuccess: async ({ deleted, failed }) => {
      const removed = new Set(deleted);
      qc.setQueriesData({ queryKey: ["jobs"] }, (data: unknown) =>
        Array.isArray(data) ? data.filter((job: Job) => !removed.has(job.id)) : data,
      );
      setSelected(new Set(failed.map(job => job.id)));
      setPendingDelete([]);
      if (openJob && removed.has(openJob)) router.replace("/jobs", { scroll: false });
      if (deleted.length) toast.success(`Deleted ${deleted.length} job record${deleted.length === 1 ? "" : "s"}`);
      if (failed.length) toast.error(`${failed.length} record${failed.length === 1 ? "" : "s"} could not be deleted`, { description: failed[0]!.message });
      await qc.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const duplicate = (job: Job) =>
    setForm({
      mode: "job",
      initial: { name: `${job.name}-copy`, server_id: job.server_id, working_dir: job.working_dir, command: job.command, env: job.env, gpus: job.gpus_requested, requested_gpu_indices: job.requested_gpu_indices },
    });
  const setOpenJob = (id: number | null) => router.replace(id ? `/jobs?job=${id}` : "/jobs", { scroll: false });

  return (
    <div className="flex flex-col gap-5">
      <QueueStrip />

      <div className="flex flex-wrap items-center gap-3">
        <div role="tablist" className="glass inline-flex gap-1 rounded-2xl p-1 shadow-none">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              role="tab"
              aria-selected={filter === f.id}
              onClick={() => { setFilter(f.id); setSelected(new Set()); }}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-xl px-3.5 text-[13px] font-medium transition",
                filter === f.id ? "bg-glass-strong text-fg shadow-tile" : "text-muted hover:text-fg",
              )}
            >
              {f.label}
              {f.id !== "all" && counts[f.id] ? <span className="tabular rounded-md bg-track px-1.5 text-[11px] text-muted">{counts[f.id]}</span> : null}
            </button>
          ))}
        </div>
        <label className="glass flex h-10 w-64 items-center gap-2 rounded-2xl px-3 shadow-none">
          <Search className="size-4 text-muted" />
          <input value={query} onChange={(e) => { setQuery(e.target.value); setSelected(new Set()); }} placeholder="Filter by name or command" className="w-full bg-transparent text-[13px] outline-none placeholder:text-subtle" />
        </label>
        <div className="ml-auto flex gap-2.5">
          <Button onClick={() => setForm({ mode: "sweep", initial: null })}><Layers /> New sweep</Button>
          <Button variant="primary" onClick={() => setForm({ mode: "job", initial: null })}><Plus /> New job</Button>
        </div>
      </div>

      <GlassCard className="px-3 pb-3 pt-4">
        {canManage ? <div className="mb-3 flex flex-wrap items-center gap-3 px-3">
          <Button size="sm" disabled={!deletable.length || removeJobs.isPending} onClick={() => setSelected(new Set(deletable.map(job => job.id)))}>Select finished shown</Button>
          {visibleSelection.size ? <Button size="sm" variant="ghost" disabled={removeJobs.isPending} onClick={() => setSelected(new Set())}>Clear selection</Button> : null}
          <span className="text-xs text-muted">{visibleSelection.size ? `${visibleSelection.size} selected` : "Canceled jobs stay in history until deleted."}</span>
          <Button size="sm" variant="danger" className="ml-auto" disabled={!visibleSelection.size || removeJobs.isPending} loading={removeJobs.isPending} onClick={() => setPendingDelete([...visibleSelection])}><Trash2 /> Delete selected{visibleSelection.size ? ` (${visibleSelection.size})` : ""}</Button>
        </div> : null}
        <JobsTable jobs={rows} loading={jobs.isLoading} detailed onOpen={(j) => setOpenJob(j.id)} onDuplicate={duplicate}
          selected={visibleSelection} onSelect={canManage ? setSelected : undefined} selectionDisabled={removeJobs.isPending} />
      </GlassCard>

      <Dialog open={pendingDelete.length > 0} onOpenChange={(open) => { if (!open && !removeJobs.isPending) setPendingDelete([]); }}>
        <DialogContent className="max-w-md">
          <DialogHeader icon={<Trash2 />} title={`Delete ${pendingDelete.length} job record${pendingDelete.length === 1 ? "" : "s"}?`}
            description="This removes completed, failed or canceled jobs from history. Server logs and training files are kept. Running and queued jobs cannot be deleted." />
          <DialogFooter>
            <Button disabled={removeJobs.isPending} onClick={() => setPendingDelete([])}>Keep records</Button>
            <Button variant="danger" loading={removeJobs.isPending} disabled={removeJobs.isPending} onClick={() => removeJobs.mutate(pendingDelete)}>Delete records</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <JobFormDialog
        open={!!form}
        onOpenChange={(o) => !o && setForm(null)}
        mode={form?.mode ?? "job"}
        initial={form?.initial}
        servers={servers ?? []}
      />
      <JobDetailDialog
        jobId={openJob}
        onOpenChange={(o) => !o && setOpenJob(null)}
        onDuplicate={(job) => {
          setOpenJob(null);
          duplicate(job);
        }}
      />
    </div>
  );
}

export default function JobsPage() {
  return (
    <Suspense>
      <JobsPageInner />
    </Suspense>
  );
}
