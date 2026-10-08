"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { TransfersTable } from "@/components/transfers/transfers-table";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/card";
import { transfersApi } from "@/lib/api";
import { formatByteRate } from "@/lib/format";
import { useTransfersLive } from "@/lib/hooks/use-transfers-live";
import type { TransferStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const FILTERS: { id: "all" | "active" | TransferStatus; label: string }[] = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "completed", label: "Completed" },
  { id: "failed", label: "Failed" },
  { id: "canceled", label: "Canceled" },
];

export default function TransfersPage() {
  const qc = useQueryClient();
  const transfers = useTransfersLive(300);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");

  const rows = (transfers.data ?? []).filter((t) =>
    filter === "all" ? true : filter === "active" ? t.status === "queued" || t.status === "transferring" : t.status === filter,
  );
  const active = (transfers.data ?? []).filter((t) => t.status === "transferring");
  const totalSpeed = active.reduce((s, t) => s + (t.speed_bps ?? 0), 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <div role="tablist" className="glass inline-flex gap-1 rounded-2xl p-1 shadow-none">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              role="tab"
              aria-selected={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                "h-8 rounded-xl px-3.5 text-[13px] font-medium transition",
                filter === f.id ? "bg-glass-strong text-fg shadow-tile" : "text-muted hover:text-fg",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        {active.length ? (
          <span className="tabular text-[13px] text-muted">
            {active.length} active · {formatByteRate(totalSpeed)}
          </span>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          onClick={() =>
            transfersApi.clearFinished().then(
              () => {
                void qc.invalidateQueries({ queryKey: ["transfers"] });
                toast("Cleared finished transfers");
              },
              (e: Error) => toast.error(e.message),
            )
          }
        >
          <Trash2 /> Clear finished
        </Button>
      </div>
      <GlassCard className="px-3 pb-3 pt-4">
        <TransfersTable transfers={rows} loading={transfers.isLoading} detailed />
      </GlassCard>
    </div>
  );
}
