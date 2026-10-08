"use client";

import { useQuery } from "@tanstack/react-query";
import { Layers, Microchip, Plus, Search } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { JobDetailDialog } from "@/components/jobs/job-detail-dialog";
import { JobFormDialog, type JobFormInitial, type JobFormMode } from "@/components/jobs/job-form-dialog";
import { JobsTable } from "@/components/jobs/jobs-table";
import { StatusDot } from "@/components/server/status-badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/card";
import { jobsApi } from "@/lib/api";
import { useServerMap, useServers } from "@/lib/hooks/queries";
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
  const jobs = useQuery({ queryKey: ["jobs", "page"], queryFn: () => jobsApi.list({ limit: 500 }), refetchInterval: 3000 });
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [query, setQuery] = useState("");
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

  const duplicate = (job: Job) =>
    setForm({
      mode: "job",
      initial: { name: `${job.name}-copy`, server_id: job.server_id, working_dir: job.working_dir, command: job.command, env: job.env, gpus: job.gpus_requested },
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
              onClick={() => setFilter(f.id)}
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
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by name or command" className="w-full bg-transparent text-[13px] outline-none placeholder:text-subtle" />
        </label>
        <div className="ml-auto flex gap-2.5">
          <Button onClick={() => setForm({ mode: "sweep", initial: null })}><Layers /> New sweep</Button>
          <Button variant="primary" onClick={() => setForm({ mode: "job", initial: null })}><Plus /> New job</Button>
        </div>
      </div>

      <GlassCard className="px-3 pb-3 pt-4">
        <JobsTable jobs={rows} loading={jobs.isLoading} detailed onOpen={(j) => setOpenJob(j.id)} onDuplicate={duplicate} />
      </GlassCard>

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
