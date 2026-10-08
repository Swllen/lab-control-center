"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowLeftRight, ArrowRight, ArrowUp, File, Folder, RotateCw, X } from "lucide-react";
import { toast } from "sonner";
import { triggerDownload } from "@/lib/download";
import { StatusPill } from "@/components/jobs/job-status";
import { EmptyState, ProgressBar, Skeleton } from "@/components/ui/misc";
import { transfersApi } from "@/lib/api";
import { formatByteRate, formatBytes, formatEta, formatRelative } from "@/lib/format";
import { useServerMap } from "@/lib/hooks/queries";
import type { Transfer } from "@/lib/types";

function DirectionIcon({ t }: { t: Transfer }) {
  if (t.direction === "upload") return <ArrowUp className="size-4 text-success" aria-label="Upload" />;
  if (t.direction === "download") return <ArrowDown className="size-4 text-primary" aria-label="Download" />;
  return <ArrowRight className="size-4 text-violet" aria-label="Server to server" />;
}

const ACTIVE = new Set(["queued", "transferring"]);

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="grid size-7 place-items-center rounded-lg text-muted transition hover:bg-tile-hover hover:text-fg [&_svg]:size-3.5"
    >
      {children}
    </button>
  );
}

export function TransfersTable({
  transfers,
  loading,
  detailed = false,
}: {
  transfers: Transfer[] | undefined;
  loading?: boolean;
  detailed?: boolean;
}) {
  const servers = useServerMap();
  const qc = useQueryClient();
  const now = Date.now();
  const serverName = (id: number | null) => (id != null ? servers.get(id)?.name ?? "—" : "local");

  const cancel = (t: Transfer) =>
    transfersApi.cancel(t.id).then(
      () => toast("Canceling…"),
      (e: Error) => toast.error(e.message),
    );
  const retry = (t: Transfer) => {
    if (t.direction === "download" && t.source_server_id != null) {
      triggerDownload(t.source_server_id, t.source_path);
      return;
    }
    if (t.direction === "upload") {
      toast("Re-upload the file from the Files page", { description: "The browser holds the file, so uploads are retried from there." });
      return;
    }
    transfersApi.retry(t.id).then(
      () => void qc.invalidateQueries({ queryKey: ["transfers"] }),
      (e: Error) => toast.error(e.message),
    );
  };

  if (loading) {
    return (
      <div className="space-y-2 p-2">
        {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-9 w-full" />)}
      </div>
    );
  }
  if (!transfers?.length) {
    return (
      <EmptyState icon={<ArrowLeftRight />} title="No transfers yet" description="Uploads, downloads and server-to-server copies appear here." />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-separate border-spacing-0 text-[13px]">
        <thead>
          <tr className="text-left text-[12.5px] text-muted [&_th]:border-b [&_th]:border-line [&_th]:px-3 [&_th]:pb-2.5 [&_th]:pt-1 [&_th]:font-medium">
            <th>Name</th>
            <th className="text-center">Direction</th>
            <th>Server</th>
            {detailed ? <th>Destination / source</th> : null}
            <th>Size</th>
            {detailed ? <th className="w-[15%]">Progress</th> : null}
            {detailed ? <th>Speed</th> : null}
            {detailed ? <th>ETA</th> : null}
            <th>Status</th>
            <th>Time</th>
            {detailed ? <th className="w-16" /> : null}
          </tr>
        </thead>
        <tbody>
          {transfers.map((t) => {
            const active = ACTIVE.has(t.status);
            const pct = t.size_bytes ? Math.min(100, Math.round((100 * t.transferred_bytes) / t.size_bytes)) : t.status === "completed" ? 100 : 0;
            const server = t.direction === "upload" ? t.dest_server_id : t.source_server_id;
            return (
              <tr
                key={t.id}
                className="transition-colors hover:bg-tile-hover [&_td]:border-b [&_td]:border-line [&_td]:px-3 [&_td]:py-2.5 last:[&_td]:border-0"
                title={t.error ?? undefined}
              >
                <td className="max-w-[220px]">
                  <span className="flex items-center gap-2.5">
                    {t.is_directory ? <Folder className="size-4 shrink-0 text-muted" /> : <File className="size-4 shrink-0 text-muted" />}
                    <span className="truncate">{t.filename}</span>
                  </span>
                </td>
                <td><span className="flex justify-center"><DirectionIcon t={t} /></span></td>
                <td className="whitespace-nowrap text-fg/80">
                  {t.direction === "server_to_server"
                    ? `${serverName(t.source_server_id)} → ${serverName(t.dest_server_id)}`
                    : serverName(server)}
                </td>
                {detailed ? (
                  <td className="max-w-[280px] truncate font-mono text-[12px] text-muted" title={t.direction === "download" ? t.source_path : t.dest_path}>
                    {t.direction === "download" ? t.source_path : t.dest_path}
                    {t.error ? <span className="block truncate font-sans text-[11.5px] text-danger">{t.error}</span> : null}
                  </td>
                ) : null}
                <td className="tabular whitespace-nowrap text-fg/80">
                  {t.size_bytes != null ? formatBytes(t.size_bytes) : active ? formatBytes(t.transferred_bytes) : "—"}
                </td>
                {detailed ? (
                  <td>
                    <div className="flex items-center gap-2">
                      <ProgressBar
                        value={t.size_bytes ? pct : active ? 100 : pct}
                        tone={t.status === "completed" ? "success" : t.status === "failed" ? "danger" : t.status === "canceled" || t.status === "queued" ? "neutral" : "primary"}
                        className={t.size_bytes || !active ? "h-[6px]" : "h-[6px] animate-pulse"}
                      />
                      <span className="tabular w-9 text-right text-[12px]">{t.size_bytes ? `${pct}%` : ""}</span>
                    </div>
                  </td>
                ) : null}
                {detailed ? <td className="tabular whitespace-nowrap text-fg/80">{active ? formatByteRate(t.speed_bps) : "—"}</td> : null}
                {detailed ? <td className="tabular whitespace-nowrap text-fg/80">{active ? formatEta(t.eta_s) : "—"}</td> : null}
                <td><StatusPill status={t.status} /></td>
                <td className="tabular whitespace-nowrap text-fg/80">
                  {t.status === "transferring" && !detailed && t.size_bytes ? `${pct}%` : formatRelative(t.ended_at ?? t.created_at, now)}
                </td>
                {detailed ? (
                  <td className="text-right">
                    {active ? (
                      <IconButton label="Cancel" onClick={() => void cancel(t)}><X /></IconButton>
                    ) : t.status === "failed" || t.status === "canceled" ? (
                      <IconButton label="Retry" onClick={() => retry(t)}><RotateCw /></IconButton>
                    ) : null}
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
