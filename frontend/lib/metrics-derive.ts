import { shortGpuName } from "@/lib/format";
import type { MetricsSnapshot, ServerStatic } from "@/lib/types";
import { mean, sum } from "@/lib/utils";

export interface GpuSummary {
  count: number;
  label: string; // "4 × NVIDIA H100"
  utilization: number;
  memUsed: number;
  memTotal: number;
  memPercent: number;
  avgTemp: number | null;
  maxTemp: number | null;
  power: number | null;
  perGpuUtil: number[];
  perGpuMem: number[];
}

export function summarizeGpus(stat: ServerStatic | null, snap: MetricsSnapshot | null): GpuSummary | null {
  const gpus = snap?.gpus ?? [];
  const inventory = stat?.gpus ?? [];
  const count = gpus.length || inventory.length;
  if (count === 0) return null;

  const names = [...new Set(inventory.map((g) => shortGpuName(g.name).replace(/^NVIDIA /, "")))];
  const label = names.length === 1 ? `${count} × ${names[0]}` : `${count} GPUs (mixed)`;
  const temps = gpus.map((g) => g.temperature_c).filter((t): t is number => t != null);
  const powers = gpus.map((g) => g.power_w).filter((p): p is number => p != null);
  const memUsed = sum(gpus.map((g) => g.memory_used));
  const memTotal = sum(gpus.map((g) => g.memory_total)) || sum(inventory.map((g) => g.memory_total));

  return {
    count,
    label,
    utilization: mean(gpus.map((g) => g.utilization)),
    memUsed,
    memTotal,
    memPercent: memTotal ? (100 * memUsed) / memTotal : 0,
    avgTemp: temps.length ? mean(temps) : null,
    maxTemp: temps.length ? Math.max(...temps) : null,
    power: powers.length ? sum(powers) : null,
    perGpuUtil: gpus.map((g) => g.utilization),
    perGpuMem: gpus.map((g) => (g.memory_total ? (100 * g.memory_used) / g.memory_total : 0)),
  };
}

export function gpuUtilSeries(history: MetricsSnapshot[]): number[] {
  return history.map((s) => mean(s.gpus.map((g) => g.utilization)));
}

export function vramSeries(history: MetricsSnapshot[]): number[] {
  return history.map((s) => {
    const total = sum(s.gpus.map((g) => g.memory_total));
    return total ? (100 * sum(s.gpus.map((g) => g.memory_used))) / total : 0;
  });
}

export function diskTotals(snap: MetricsSnapshot | null): { used: number; total: number; percent: number } | null {
  if (!snap || snap.disks.length === 0) return null;
  const used = sum(snap.disks.map((d) => d.used));
  const total = sum(snap.disks.map((d) => d.total));
  return { used, total, percent: total ? (100 * used) / total : 0 };
}

export function maxLinkSpeed(stat: ServerStatic | null): number | null {
  const speeds = (stat?.interfaces ?? [])
    .filter((i) => !i.name.startsWith("ib"))
    .map((i) => i.speed_mbps ?? 0);
  const best = Math.max(0, ...speeds);
  return best > 0 ? best : null;
}
