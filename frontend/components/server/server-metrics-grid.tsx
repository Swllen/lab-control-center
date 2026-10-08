"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Cpu, Database, MemoryStick, Microchip, MonitorDot } from "lucide-react";
import { MetricTile, MiniBars } from "@/components/metrics/metric-tile";
import { RingGauge, toneForLoad } from "@/components/metrics/ring-gauge";
import { Sparkline } from "@/components/metrics/sparkline";
import { ProgressBar, Skeleton } from "@/components/ui/misc";
import { formatBitRate, formatBytes, formatLinkSpeed, formatWatts } from "@/lib/format";
import type { LiveMetrics } from "@/lib/metrics-store";
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
              <div className="flex items-center justify-between gap-3">
                <MiniBars values={gpu.perGpuUtil} labels={gpu.perGpuUtil.map((u, i) => `GPU ${i}: ${Math.round(u)}% util`)} />
                <span className="tabular truncate text-[11.5px] text-muted">
                  {gpu.maxTemp != null ? `${Math.round(gpu.maxTemp)}°C max` : ""}
                  {gpu.power != null ? ` · ${formatWatts(gpu.power)}` : ""}
                </span>
              </div>
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
            subtitle={`${formatBytes(gpu.memTotal)} total`}
            footer={
              <div className="flex items-center justify-between gap-3">
                <MiniBars values={gpu.perGpuMem} labels={gpu.perGpuMem.map((m, i) => `GPU ${i}: ${Math.round(m)}% memory`)} />
                <span className="tabular truncate text-[11.5px] text-muted">
                  {formatBytes(gpu.memUsed)} used
                </span>
              </div>
            }
          >
            <RingGauge value={gpu.memPercent} tone={toneForLoad(gpu.memPercent, "green")} />
            <Sparkline className="ml-1 min-w-0 max-w-[110px] flex-[1_1_0]" values={vramSeries(history)} max={100} tone="green" />
          </MetricTile>
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
