"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Cpu, Database, MemoryStick, Microchip, MonitorDot } from "lucide-react";
import { MetricTile } from "@/components/metrics/metric-tile";
import { RingGauge, toneForLoad } from "@/components/metrics/ring-gauge";
import { Sparkline } from "@/components/metrics/sparkline";
import { ProgressBar, Skeleton } from "@/components/ui/misc";
import { formatBitRate, formatBytes, formatLinkSpeed, formatWatts } from "@/lib/format";
import type { LiveMetrics } from "@/lib/metrics-store";
import type { GpuMetrics } from "@/lib/types";
import { cn } from "@/lib/utils";
import { diskTotals, gpuUtilSeries, maxLinkSpeed, summarizeGpus, vramSeries } from "@/lib/metrics-derive";

const SPARK_POINTS = 40;

export function ServerMetricsGrid({ live, dimmed }: { live: LiveMetrics; dimmed: boolean }) {
  const { latest: snap, static: stat } = live;
  const history = live.history.slice(-SPARK_POINTS);

  if (!snap || !stat) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="tile flex h-[84px] items-center gap-3 rounded-2xl px-4">
            <Skeleton className="size-6 rounded-md" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="size-12 rounded-full" />
          </div>
        ))}
      </div>
    );
  }

  const gpu = summarizeGpus(stat, snap);
  const disk = diskTotals(snap);
  const link = formatLinkSpeed(maxLinkSpeed(stat));
  const cpuTone = toneForLoad(snap.cpu.percent, "blue");
  const memTone = toneForLoad(snap.memory.percent, "violet");

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <MetricTile dimmed={dimmed} icon={<Cpu />} title="CPU" subtitle={`${stat.cpu_cores} cores`}>
        <RingGauge value={snap.cpu.percent} tone={cpuTone} />
        <Sparkline className="ml-1 min-w-0 max-w-[110px] flex-[1_1_0]" values={history.map((s) => s.cpu.percent)} max={100} tone={cpuTone} />
      </MetricTile>

      <MetricTile dimmed={dimmed} icon={<MemoryStick />} iconTone="violet" title="RAM" subtitle={formatBytes(snap.memory.total)}>
        <RingGauge value={snap.memory.percent} tone={memTone} />
        <Sparkline className="ml-1 min-w-0 max-w-[110px] flex-[1_1_0]" values={history.map((s) => s.memory.percent)} max={100} tone={memTone} />
      </MetricTile>

      {gpu ? (
        <>
          <MetricTile
            dimmed={dimmed}
            icon={<Microchip />}
            iconTone="green"
            title="GPU"
            subtitle={gpu.label}
            footer={
              gpu.maxTemp != null || gpu.power != null ? (
                <span className="tabular block truncate text-[11.5px] text-muted">
                  {[gpu.maxTemp != null ? `${Math.round(gpu.maxTemp)}°C max` : null, gpu.power != null ? formatWatts(gpu.power) : null]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              ) : undefined
            }
          >
            <RingGauge value={gpu.utilization} tone="green" />
            <Sparkline className="ml-1 min-w-0 max-w-[110px] flex-[1_1_0]" values={gpuUtilSeries(history)} max={100} tone="green" />
          </MetricTile>

          <MetricTile
            dimmed={dimmed}
            icon={<MonitorDot />}
            iconTone="green"
            title="VRAM"
            subtitle={`${formatBytes(gpu.memUsed)} / ${formatBytes(gpu.memTotal)}`}
            footer={
              <span className="tabular block truncate text-[11.5px] text-muted">
                {formatBytes(Math.max(gpu.memTotal - gpu.memUsed, 0))} free
              </span>
            }
          >
            <RingGauge value={gpu.memPercent} tone={toneForLoad(gpu.memPercent, "green")} />
            <Sparkline className="ml-1 min-w-0 max-w-[110px] flex-[1_1_0]" values={vramSeries(history)} max={100} tone="green" />
          </MetricTile>

          <PerGpuList gpus={snap.gpus} dimmed={dimmed} />
        </>
      ) : (
        <MetricTile dimmed={dimmed} className="sm:col-span-2" icon={<Microchip />} iconTone="green" title="GPU" subtitle="No NVIDIA GPU detected" />
      )}

      <MetricTile dimmed={dimmed} icon={<Database />} title="Disk Usage" subtitle={disk ? `${formatBytes(disk.used)} / ${formatBytes(disk.total)}` : "No disks"}>
        <div className="flex w-[45%] flex-col items-end gap-2">
          <span className="tabular text-[14px] font-semibold">{disk ? `${Math.round(disk.percent)}%` : "—"}</span>
          <ProgressBar value={disk?.percent ?? 0} tone={disk && disk.percent > 90 ? "danger" : "primary"} className="h-1.5" />
        </div>
      </MetricTile>

      <MetricTile dimmed={dimmed} icon={<ArrowUpDown />} title="Network" subtitle={link ? `${link} link` : `${stat.interfaces.length} interfaces`}>
        <Sparkline className="min-w-0 max-w-[100px] flex-[1_1_0]" values={history.map((s) => s.net.rx_bps + s.net.tx_bps)} tone="blue" height={30} />
        <div className="tabular flex shrink-0 flex-col gap-1 text-[12.5px] text-muted">
          <span className="flex items-center gap-1"><ArrowUp className="size-3.5 text-primary" />{formatBitRate(snap.net.tx_bps)}</span>
          <span className="flex items-center gap-1"><ArrowDown className="size-3.5 text-primary" />{formatBitRate(snap.net.rx_bps)}</span>
        </div>
      </MetricTile>
    </div>
  );
}

const GPU_COLS: Record<number, string> = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-3" };

/** "58/96 GB": both sides in the total's unit, compact enough for a narrow cell. */
function formatGpuMem(used: number, total: number): string {
  const gb = (b: number) => b / 1024 ** 3;
  const fmt = (v: number) => (v >= 10 ? Math.round(v).toString() : v.toFixed(1).replace(/\.0$/, ""));
  return `${fmt(gb(used))}/${fmt(gb(total))} GB`;
}

/** One small tile per card, so a busy (or idle) GPU can't hide in the average. */
function PerGpuList({ gpus, dimmed }: { gpus: GpuMetrics[]; dimmed: boolean }) {
  if (gpus.length < 2) return null;
  return (
    <div className={cn("grid grid-cols-2 gap-3 sm:col-span-2", GPU_COLS[gpus.length] ?? "sm:grid-cols-4")}>
      {gpus.map((g) => {
        const memPct = g.memory_total ? (100 * g.memory_used) / g.memory_total : 0;
        const hot = g.temperature_c != null && g.temperature_c >= 85;
        return (
          <div
            key={g.index}
            className={cn(
              "tile min-w-0 rounded-2xl px-3.5 py-3 transition-[background-color,opacity] duration-300 hover:bg-tile-hover",
              dimmed && "opacity-55 saturate-50",
            )}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[13px] font-semibold">GPU {g.index}</span>
              {g.temperature_c != null ? (
                <span className={cn("tabular text-[11.5px]", hot ? "text-warning" : "text-muted")}>
                  {Math.round(g.temperature_c)}°C
                </span>
              ) : null}
            </div>
            <div className="mt-2 flex justify-between gap-2 text-[11.5px]">
              <span className="text-muted">Util</span>
              <span className="tabular font-medium">{Math.round(g.utilization)}%</span>
            </div>
            <ProgressBar value={g.utilization} tone="success" className="mt-1 h-1" />
            <div className="mt-2 flex justify-between gap-2 text-[11.5px]">
              <span className="text-muted">VRAM</span>
              <span className="tabular truncate font-medium" title={`${formatBytes(g.memory_used)} / ${formatBytes(g.memory_total)}`}>
                {formatGpuMem(g.memory_used, g.memory_total)}
              </span>
            </div>
            <ProgressBar value={memPct} tone={memPct > 92 ? "danger" : "success"} className="mt-1 h-1" />
          </div>
        );
      })}
    </div>
  );
}
