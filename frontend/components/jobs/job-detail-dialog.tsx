"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, CopyPlus, FolderOpen, RotateCw, Square, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ProgressBar } from "@/components/ui/misc";
import { jobsApi } from "@/lib/api";
import { formatDuration, formatRelative } from "@/lib/format";
import { useServerMap } from "@/lib/hooks/queries";
import type { Job } from "@/lib/types";
import { copyToClipboard, cn } from "@/lib/utils";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { StatusPill, progressTone } from "./job-status";

function Fact({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11.5px] text-muted">{label}</dt>
      <dd className={cn("mt-0.5 truncate text-[13px]", mono && "font-mono text-[12.5px]")}>{children ?? "—"}</dd>
    </div>
  );
}

function LogViewer({ job }: { job: Job }) {
  const [stream, setStream] = useState<"stdout" | "stderr">("stdout");
  const [follow, setFollow] = useState(true);
  const pre = useRef<HTMLPreElement>(null);
  const live = job.status === "running";
  const { data, isLoading, error } = useQuery({
    queryKey: ["job-logs", job.id, stream],
    queryFn: () => jobsApi.logs(job.id, stream),
    refetchInterval: live ? 2000 : false,
    enabled: !!job.stdout_path,
  });

  useEffect(() => {
    if (follow && pre.current) pre.current.scrollTop = pre.current.scrollHeight;
  }, [data, follow]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-[#0f1624] ring-1 ring-white/[0.06]">
      <div className="flex items-center gap-1 border-b border-white/[0.06] bg-[#141d2e] px-2 py-1.5 text-[12px]">
        {(["stdout", "stderr"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStream(s)}
            className={cn("rounded-md px-2.5 py-1 font-mono transition", stream === s ? "bg-white/10 text-slate-100" : "text-slate-400 hover:text-slate-200")}
          >
            {s}
          </button>
        ))}
        {live ? <span className="ml-2 flex items-center gap-1.5 text-emerald-400"><span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />live</span> : null}
        <span className="ml-auto truncate pl-3 font-mono text-[11px] text-slate-500">{data?.path ?? ""}</span>
        <label className="ml-2 flex shrink-0 items-center gap-1.5 text-slate-400">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} className="accent-[#4d82ff]" />
          Follow
        </label>
      </div>
      <pre
        ref={pre}
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          if (!atBottom && follow) setFollow(false);
        }}
        className="min-h-[220px] flex-1 overflow-auto whitespace-pre-wrap break-all px-4 py-3 font-mono text-[12px] leading-relaxed text-slate-200"
      >
        {!job.stdout_path
          ? "The job has not started yet."
          : isLoading
            ? "Loading…"
            : error
              ? `Could not read log: ${(error as Error).message}`
              : data?.content
                ? (data.truncated ? "… (showing the last 64 KB)\n" : "") + data.content
                : `(${stream} is empty)`}
      </pre>
    </div>
  );
}

export function JobDetailDialog({
  jobId,
  onOpenChange,
  onDuplicate,
}: {
  jobId: number | null;
  onOpenChange: (o: boolean) => void;
  onDuplicate: (job: Job) => void;
}) {
  const qc = useQueryClient();
  const servers = useServerMap();
  const { data: job } = useQuery({
    queryKey: ["jobs", "detail", jobId],
    queryFn: () => jobsApi.get(jobId!),
    enabled: jobId != null,
    refetchInterval: (q) => (q.state.data && ["queued", "running"].includes(q.state.data.status) ? 2000 : false),
  });
  const now = Date.now();

  const act = (fn: () => Promise<unknown>, done: string) =>
    fn().then(
      () => {
        toast(done);
        void qc.invalidateQueries({ queryKey: ["jobs"] });
      },
      (e: Error) => toast.error(e.message),
    );

  const jobDir = job?.stdout_path ? job.stdout_path.replace(/\/stdout\.log$/, "") : null;
  const duration = job?.started_at ? (job.ended_at ? new Date(job.ended_at).getTime() : now) - new Date(job.started_at).getTime() : null;

  return (
    <Dialog open={jobId != null} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(860px,calc(100vh-32px))] max-w-[980px] flex-col gap-0 p-0">
        {job ? (
          <>
            <div className="flex flex-wrap items-start gap-3 border-b border-line px-6 pb-4 pt-5 pr-14">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2.5">
                  <span className="tabular text-[13px] text-muted">#{job.id}</span>
                  <DialogPrimitive.Title className="truncate text-[18px] font-semibold tracking-[-0.01em]">{job.name}</DialogPrimitive.Title>
                  <StatusPill status={job.status} />
                </div>
                <DialogPrimitive.Description className="mt-1 text-[12.5px] text-muted">
                  {job.status === "queued" ? job.wait_reason : job.error ?? `${servers.get(job.server_id)?.name ?? "server"} · created ${formatRelative(job.created_at, now)}`}
                </DialogPrimitive.Description>
              </div>
              <div className="flex flex-wrap gap-2">
                {job.status === "queued" || job.status === "running" ? (
                  <Button size="sm" variant="danger" onClick={() => act(() => jobsApi.cancel(job.id), "Job canceled")}><Square className="fill-current" /> Cancel</Button>
                ) : (
                  <Button size="sm" onClick={() => act(() => jobsApi.retry(job.id), "Job re-queued")}><RotateCw /> Retry</Button>
                )}
                <Button size="sm" onClick={() => onDuplicate(job)}><CopyPlus /> Duplicate</Button>
                {job.status !== "queued" && job.status !== "running" ? (
                  <Button size="sm" variant="ghost" className="hover:bg-danger-soft hover:text-danger" onClick={() => act(() => jobsApi.remove(job.id), "Removed from history").then(() => onOpenChange(false))}>
                    <Trash2 />
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
              {job.status === "running" && job.progress != null ? (
                <div className="flex items-center gap-3">
                  <ProgressBar value={job.progress * 100} tone={progressTone(job.status)} />
                  <span className="tabular w-12 text-right text-[13px] font-medium">{Math.round(job.progress * 100)}%</span>
                </div>
              ) : null}
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
                <Fact label="Server">{servers.get(job.server_id)?.name}</Fact>
                <Fact label="GPUs">
                  {job.gpus_requested === 0 ? "CPU only" : `${job.gpus_requested}${job.requested_gpu_indices ? ` selected [${job.requested_gpu_indices.join(", ")}]` : " requested"}${job.gpu_indices ? ` → [${job.gpu_indices.join(", ")}]` : ""}`}
                </Fact>
                <Fact label="Started">{job.started_at ? formatRelative(job.started_at, now) : "—"}</Fact>
                <Fact label="Duration">{duration != null ? formatDuration(duration) : "—"}</Fact>
                <Fact label="Working directory" mono>{job.working_dir}</Fact>
                <Fact label="PID" mono>{job.pid}</Fact>
                <Fact label="Exit code" mono>{job.exit_code}</Fact>
                <Fact label="Job folder" mono>
                  {jobDir ? (
                    <Link href={`/files?server=${job.server_id}&path=${encodeURIComponent(jobDir)}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                      <FolderOpen className="size-3.5" /> open
                    </Link>
                  ) : "—"}
                </Fact>
              </dl>

              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[12px] font-medium text-muted">Command</span>
                  <button type="button" onClick={() => void copyToClipboard(job.command).then(() => toast("Command copied"))} className="flex items-center gap-1 text-[12px] text-muted hover:text-fg">
                    <Copy className="size-3.5" /> Copy
                  </button>
                </div>
                <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-track px-3.5 py-2.5 font-mono text-[12.5px]">{job.command}</pre>
              </div>

              {Object.keys(job.env).length || Object.keys(job.params).length ? (
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(job.params).map(([k, v]) => (
                    <span key={`p-${k}`} className="rounded-lg bg-primary-soft px-2 py-0.5 font-mono text-[11.5px] text-primary">{k}={String(v)}</span>
                  ))}
                  {Object.entries(job.env).map(([k, v]) => (
                    <span key={`e-${k}`} className="rounded-lg bg-track px-2 py-0.5 font-mono text-[11.5px] text-muted" title={v}>{k}={v.length > 40 ? `${v.slice(0, 40)}…` : v}</span>
                  ))}
                </div>
              ) : null}

              <LogViewer job={job} />
            </div>
          </>
        ) : (
          <div className="grid flex-1 place-items-center text-[13px] text-muted">
            <DialogPrimitive.Title className="sr-only">Job</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">Loading job</DialogPrimitive.Description>
            Loading…
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
