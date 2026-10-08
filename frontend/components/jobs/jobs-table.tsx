"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CopyPlus, ListChecks, RotateCw, ScrollText, Square } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { EmptyState, ProgressBar, Skeleton } from "@/components/ui/misc";
import { jobsApi } from "@/lib/api";
import { formatDuration, formatRelative } from "@/lib/format";
import { useServerMap } from "@/lib/hooks/queries";
import type { Job } from "@/lib/types";
import { cn } from "@/lib/utils";
import { StatusPill, progressTone } from "./job-status";

function jobProgress(job: Job): number | null {
  if (job.status === "completed") return 100;
  return job.progress != null ? Math.round(job.progress * 100) : null;
}

function jobDuration(job: Job, now: number): string {
  if (!job.started_at) return "-";
  const end = job.ended_at ? new Date(job.ended_at).getTime() : now;
  return formatDuration(end - new Date(job.started_at).getTime());
}

function Action({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="grid size-7 place-items-center rounded-lg text-muted transition hover:bg-tile-hover hover:text-fg [&_svg]:size-3.5"
    >
      {children}
    </button>
  );
}

export function JobsTable({
  jobs,
  loading,
  detailed = false,
  onOpen,
  onDuplicate,
}: {
  jobs: Job[] | undefined;
  loading?: boolean;
  detailed?: boolean;
  onOpen?: (job: Job) => void;
  onDuplicate?: (job: Job) => void;
}) {
  const servers = useServerMap();
  const qc = useQueryClient();
  const now = Date.now();

  const act = (fn: () => Promise<unknown>, done: string) =>
    fn().then(
      () => {
        toast(done);
        void qc.invalidateQueries({ queryKey: ["jobs"] });
      },
      (e: Error) => toast.error(e.message),
    );

  if (loading) {
    return (
      <div className="space-y-2 p-2">
        {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-9 w-full" />)}
      </div>
    );
  }
  if (!jobs?.length) {
    return <EmptyState icon={<ListChecks />} title="No jobs yet" description="Queued experiments and parameter sweeps will appear here." />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-separate border-spacing-0 text-[13px]">
        <thead>
          <tr className="text-left text-[12.5px] text-muted [&_th]:border-b [&_th]:border-line [&_th]:px-3 [&_th]:pb-2.5 [&_th]:pt-1 [&_th]:font-medium">
            <th className="w-14">#</th>
            <th>Name</th>
            <th>Server</th>
            <th>Status</th>
            <th className="w-[20%]">Progress</th>
            {detailed ? <th>GPUs</th> : null}
            <th>Started</th>
            <th>Duration</th>
            {detailed ? <th className="w-24" /> : null}
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => {
            const pct = jobProgress(job);
            const active = job.status === "queued" || job.status === "running";
            return (
              <tr
                key={job.id}
                onClick={() => onOpen?.(job)}
                className={cn(
                  "transition-colors hover:bg-tile-hover [&_td]:border-b [&_td]:border-line [&_td]:px-3 [&_td]:py-2.5 last:[&_td]:border-0",
                  onOpen && "cursor-pointer",
                )}
                title={job.command}
              >
                <td className="tabular text-muted">{job.id}</td>
                <td className="max-w-[260px]">
                  <span className="block truncate font-medium">{job.name}</span>
                  {detailed && Object.keys(job.params).length ? (
                    <span className="block truncate font-mono text-[11px] text-subtle">
                      {Object.entries(job.params).map(([k, v]) => `${k}=${String(v)}`).join("  ")}
                    </span>
                  ) : null}
                </td>
                <td className="text-fg/80">{servers.get(job.server_id)?.name ?? "—"}</td>
                <td>
                  <StatusPill status={job.status} />
                  {detailed && job.status === "queued" && job.wait_reason ? (
                    <span className="mt-0.5 block max-w-[220px] truncate text-[11px] text-subtle" title={job.wait_reason}>{job.wait_reason}</span>
                  ) : null}
                  {detailed && job.status === "failed" && job.error ? (
                    <span className="mt-0.5 block max-w-[220px] truncate text-[11px] text-danger" title={job.error}>{job.error}</span>
                  ) : null}
                </td>
                <td>
                  <div className="flex items-center gap-3">
                    <ProgressBar
                      value={pct ?? (job.status === "running" ? 100 : 0)}
                      tone={progressTone(job.status)}
                      className={cn("h-[7px]", job.status === "running" && pct == null && "animate-pulse opacity-60")}
                    />
                    <span className="tabular w-10 shrink-0 text-right text-[12.5px]">{pct != null ? `${pct}%` : job.status === "running" ? "" : "0%"}</span>
                  </div>
                </td>
                {detailed ? (
                  <td className="tabular text-fg/80">
                    {job.gpus_requested ? `${job.gpus_requested}${job.gpu_indices ? ` [${job.gpu_indices.join(",")}]` : ""}` : "CPU"}
                  </td>
                ) : null}
                <td className={cn("tabular text-fg/80", !job.started_at && "text-subtle")}>{job.started_at ? formatRelative(job.started_at, now) : "-"}</td>
                <td className="tabular text-fg/80">{jobDuration(job, now)}</td>
                {detailed ? (
                  <td>
                    <div className="flex justify-end gap-0.5">
                      <Action label="Logs" onClick={() => onOpen?.(job)}><ScrollText /></Action>
                      {active ? (
                        <Action label="Cancel" onClick={() => void act(() => jobsApi.cancel(job.id), `Canceled ${job.name}`)}><Square /></Action>
                      ) : (
                        <Action label="Retry" onClick={() => void act(() => jobsApi.retry(job.id), `Re-queued ${job.name}`)}><RotateCw /></Action>
                      )}
                      {onDuplicate ? <Action label="Duplicate" onClick={() => onDuplicate(job)}><CopyPlus /></Action> : null}
                    </div>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
