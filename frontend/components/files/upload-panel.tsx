"use client";

import { ChevronDown, CircleCheck, CircleX, RotateCw, Upload, X } from "lucide-react";
import { useState } from "react";
import { ProgressBar } from "@/components/ui/misc";
import { formatBytes, formatByteRate } from "@/lib/format";
import { useServerMap } from "@/lib/hooks/queries";
import { uploads, useUploads } from "@/lib/uploads/upload-store";
import { cn } from "@/lib/utils";

/** Floating upload queue; lives in the app shell so uploads stay visible across pages. */
export function UploadPanel() {
  const items = useUploads();
  const servers = useServerMap();
  const [collapsed, setCollapsed] = useState(false);
  if (items.length === 0) return null;

  const active = items.filter((i) => i.status === "uploading" || i.status === "queued");
  const failed = items.filter((i) => i.status === "error").length;
  const loaded = active.reduce((s, i) => s + i.loaded, 0);
  const total = active.reduce((s, i) => s + i.total, 0);

  return (
    <div className="glass-strong fixed bottom-5 right-5 z-40 w-[380px] max-w-[calc(100vw-40px)] overflow-hidden rounded-[20px] animate-fade-in">
      <div className="flex items-center gap-3 px-4 py-3">
        <Upload className="size-4 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold">
            {active.length ? `Uploading ${active.length} file${active.length > 1 ? "s" : ""}` : failed ? `${failed} upload${failed > 1 ? "s" : ""} failed` : "Uploads complete"}
          </p>
          {active.length ? <p className="tabular text-[11.5px] text-muted">{formatBytes(loaded)} / {formatBytes(total)}</p> : null}
        </div>
        {active.length === 0 ? (
          <button type="button" onClick={uploads.clearFinished} className="rounded-lg px-2 py-1 text-[12px] text-muted hover:bg-tile hover:text-fg">
            Clear
          </button>
        ) : null}
        <button type="button" aria-label={collapsed ? "Expand" : "Collapse"} onClick={() => setCollapsed((c) => !c)} className="grid size-7 place-items-center rounded-lg text-muted hover:bg-tile">
          <ChevronDown className={cn("size-4 transition-transform", collapsed && "rotate-180")} />
        </button>
      </div>
      {active.length ? <ProgressBar value={total ? (100 * loaded) / total : 0} className="h-1 rounded-none" /> : null}
      {collapsed ? null : (
        <ul className="max-h-[300px] overflow-y-auto border-t border-line px-2 py-1.5">
          {items.map((it) => {
            const pct = it.total ? (100 * it.loaded) / it.total : 100;
            return (
              <li key={it.id} className="rounded-xl px-2.5 py-2 hover:bg-tile/60">
                <div className="flex items-center gap-2 text-[12.5px]">
                  {it.status === "done" ? <CircleCheck className="size-4 shrink-0 text-success" /> : null}
                  {it.status === "error" || it.status === "canceled" ? <CircleX className="size-4 shrink-0 text-danger" /> : null}
                  <span className="min-w-0 flex-1 truncate font-medium" title={`${it.dir}/${it.name}`}>{it.name}</span>
                  <span className="tabular shrink-0 text-[11.5px] text-muted">
                    {it.status === "uploading" ? `${Math.round(pct)}% · ${formatByteRate(it.speed)}` : formatBytes(it.total)}
                  </span>
                  {it.status === "uploading" || it.status === "queued" ? (
                    <button type="button" aria-label="Cancel upload" onClick={() => uploads.cancel(it.id)} className="grid size-6 place-items-center rounded-md text-subtle hover:bg-danger-soft hover:text-danger">
                      <X className="size-3.5" />
                    </button>
                  ) : it.status === "error" || it.status === "canceled" ? (
                    <button type="button" aria-label="Retry upload" onClick={() => uploads.retry(it.id)} className="grid size-6 place-items-center rounded-md text-subtle hover:bg-tile hover:text-fg">
                      <RotateCw className="size-3.5" />
                    </button>
                  ) : null}
                </div>
                {it.status === "uploading" || it.status === "queued" ? (
                  <ProgressBar value={pct} className="mt-1.5 h-1" tone={it.status === "queued" ? "neutral" : "primary"} />
                ) : null}
                <p className="mt-0.5 truncate text-[11px] text-subtle">
                  {servers.get(it.serverId)?.name ?? "server"}:{it.dir}
                  {it.status === "queued" ? " · waiting" : ""}
                </p>
                {it.error ? (
                  <p className="mt-0.5 flex items-center gap-2 text-[11.5px] text-danger">
                    <span className="truncate">{it.error}</span>
                    {it.conflict ? (
                      <button type="button" onClick={() => uploads.retry(it.id, true)} className="shrink-0 font-medium underline underline-offset-2">
                        Overwrite
                      </button>
                    ) : null}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
