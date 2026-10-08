"use client";

import { Cpu, Database, Fan, MemoryStick, Microchip, Network, Thermometer, Zap } from "lucide-react";
import type { ReactNode } from "react";
import { RingGauge, toneForLoad } from "@/components/metrics/ring-gauge";
import { Sparkline } from "@/components/metrics/sparkline";
import { CardHeader, GlassCard } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/misc";
import { formatBitRate, formatBytes, formatLinkSpeed, formatUptime, formatWatts } from "@/lib/format";
import type { MetricsSnapshot, ServerStatic } from "@/lib/types";
import { cn } from "@/lib/utils";

function Stat({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[12px] text-muted">{label}</p>
      <p className={cn("tabular mt-0.5 truncate text-[14px] font-medium", mono && "font-mono text-[13px]")}>{value ?? "—"}</p>
    </div>
  );
}

export function SystemOverview({ stat, snap }: { stat: ServerStatic; snap: MetricsSnapshot | null }) {
  return (
    <GlassCard className="grid grid-cols-2 gap-x-6 gap-y-4 px-6 py-5 md:grid-cols-4 2xl:grid-cols-7">
      <Stat label="Hostname" value={stat.hostname} />
      <Stat label="Operating system" value={stat.os_name} />
      <Stat label="Kernel" value={`${stat.kernel} (${stat.arch})`} mono />
      <Stat label="Uptime" value={snap ? formatUptime(snap.uptime_s) : "—"} />
      <Stat label="GPU driver" value={stat.gpu_driver ?? "—"} mono />
      <Stat label="CUDA" value={stat.cuda_version ?? "—"} mono />
      <Stat label="GPU telemetry" value={stat.gpu_backend === "none" ? "Unavailable" : stat.gpu_backend} />
    </GlassCard>
  );
}

function coreColor(pct: number): string {
  // Interpolate track -> primary by utilization; warm when saturated.
  if (pct >= 92) return "var(--danger)";
  if (pct >= 80) return "var(--warning)";
  return `color-mix(in oklab, var(--primary) ${Math.max(pct, 6)}%, var(--track))`;
}

export function CpuSection({ stat, snap, history }: { stat: ServerStatic; snap: MetricsSnapshot; history: MetricsSnapshot[] }) {
  const [l1, l5, l15] = snap.cpu.load;
  return (
    <GlassCard className="min-w-0 pb-5">
      <CardHeader icon={<Cpu />} title="CPU" action={<span className="text-[12.5px] text-muted">{stat.cpu_cores} cores · {stat.cpu_threads} threads</span>} />
      <div className="px-6">
        <p className="truncate text-[13px] text-muted">{stat.cpu_model}</p>
        <div className="mt-4 flex items-center gap-5">
          <RingGauge value={snap.cpu.percent} tone={toneForLoad(snap.cpu.percent, "blue")} size={76} stroke={6} />
          <div className="grid flex-1 grid-cols-3 gap-4">
            <Stat label="Load 1m" value={l1.toFixed(2)} />
            <Stat label="Load 5m" value={l5.toFixed(2)} />
            <Stat label="Load 15m" value={l15.toFixed(2)} />
          </div>
        </div>
        <Sparkline className="mt-4" values={history.map((s) => s.cpu.percent)} max={100} height={56} />
        <p className="mb-2 mt-4 text-[12px] font-medium text-muted">Per-thread utilization</p>
        <div className="grid gap-[3px]" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(14px, 1fr))" }}>
          {snap.cpu.per_core.map((pct, i) => (
            <div
              key={i}
              title={`cpu${i}: ${pct.toFixed(0)}%`}
              className="aspect-square rounded-[3px] transition-colors duration-700"
              style={{ background: coreColor(pct) }}
            />
          ))}
        </div>
      </div>
    </GlassCard>
  );
}

export function MemorySection({ snap, history }: { snap: MetricsSnapshot; history: MetricsSnapshot[] }) {
  const m = snap.memory;
  const swapPct = m.swap_total ? (100 * m.swap_used) / m.swap_total : 0;
  return (
    <GlassCard className="min-w-0 pb-5">
      <CardHeader icon={<MemoryStick />} title="Memory" action={<span className="text-[12.5px] text-muted">{formatBytes(m.total)}</span>} />
      <div className="space-y-5 px-6">
        <div className="flex items-center gap-5">
          <RingGauge value={m.percent} tone={toneForLoad(m.percent, "violet")} size={76} stroke={6} />
          <div className="grid flex-1 grid-cols-3 gap-4">
            <Stat label="Used" value={formatBytes(m.used)} />
            <Stat label="Available" value={formatBytes(m.available)} />
            <Stat label="Total" value={formatBytes(m.total)} />
          </div>
        </div>
        <Sparkline values={history.map((s) => s.memory.percent)} max={100} height={56} tone="violet" />
        <div>
          <div className="mb-1.5 flex justify-between text-[12.5px]">
            <span className="font-medium text-muted">Swap</span>
            <span className="tabular text-muted">
              {m.swap_total ? `${formatBytes(m.swap_used)} / ${formatBytes(m.swap_total)}` : "Disabled"}
            </span>
          </div>
          <ProgressBar value={swapPct} tone={swapPct > 50 ? "warning" : "primary"} className="h-1.5" />
        </div>
      </div>
    </GlassCard>
  );
}

export function GpuSection({ stat, snap, history }: { stat: ServerStatic; snap: MetricsSnapshot; history: MetricsSnapshot[] }) {
  if (!snap.gpus.length) {
    return (
      <GlassCard className="px-6 py-8 text-center text-[13.5px] text-muted">
        <Microchip className="mx-auto mb-2 size-6 text-subtle" />
        No NVIDIA GPUs detected. Install the NVIDIA driver (and optionally <code className="font-mono">nvidia-ml-py</code>) on the server.
      </GlassCard>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2 2xl:grid-cols-4">
      {snap.gpus.map((g) => {
        const info = stat.gpus.find((x) => x.index === g.index);
        const memPct = g.memory_total ? (100 * g.memory_used) / g.memory_total : 0;
        const limit = g.power_limit_w ?? info?.power_limit_w ?? null;
        const powerPct = g.power_w != null && limit ? (100 * g.power_w) / limit : 0;
        return (
          <GlassCard key={g.index} className="min-w-0 p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-muted">GPU {g.index}</p>
                <p className="truncate text-[14.5px] font-semibold">{info?.name ?? "GPU"}</p>
              </div>
              <RingGauge value={g.utilization} tone="green" size={52} />
            </div>
            <Sparkline className="mt-3" values={history.map((s) => s.gpus[g.index]?.utilization ?? 0)} max={100} tone="green" height={34} />
            <div className="mt-3 space-y-3 text-[12.5px]">
              <div>
                <div className="mb-1 flex justify-between">
                  <span className="text-muted">VRAM</span>
                  <span className="tabular">{formatBytes(g.memory_used)} / {formatBytes(g.memory_total)}</span>
                </div>
                <ProgressBar value={memPct} tone={memPct > 92 ? "danger" : "success"} className="h-1.5" />
              </div>
              <div>
                <div className="mb-1 flex justify-between">
                  <span className="flex items-center gap-1 text-muted"><Zap className="size-3.5" />Power</span>
                  <span className="tabular">{formatWatts(g.power_w)}{limit ? ` / ${formatWatts(limit)}` : ""}</span>
                </div>
                <ProgressBar value={powerPct} tone={powerPct > 95 ? "warning" : "primary"} className="h-1.5" />
              </div>
              <div className="flex justify-between gap-2 pt-1 text-muted">
                <span className="tabular flex items-center gap-1"><Thermometer className="size-3.5" />{g.temperature_c != null ? `${Math.round(g.temperature_c)}°C` : "—"}</span>
                <span className="tabular flex items-center gap-1"><Fan className="size-3.5" />{g.fan_percent != null ? `${Math.round(g.fan_percent)}%` : "passive"}</span>
                <span className="tabular">{g.processes != null ? `${g.processes} proc` : ""}</span>
              </div>
            </div>
          </GlassCard>
        );
      })}
    </div>
  );
}

const thClass = "[&_th]:border-b [&_th]:border-line [&_th]:px-3 [&_th]:pb-2.5 [&_th]:font-medium [&_th]:text-left [&_th]:text-[12.5px] [&_th]:text-muted";
const tdClass = "[&_td]:border-b [&_td]:border-line [&_td]:px-3 [&_td]:py-2.5 last:[&_td]:border-0";

export function DisksSection({ snap }: { snap: MetricsSnapshot }) {
  return (
    <GlassCard className="min-w-0 pb-3">
      <CardHeader icon={<Database />} title="Disks & mount points" />
      <div className="overflow-x-auto px-3">
        <table className="w-full min-w-[520px] border-separate border-spacing-0 text-[13px]">
          <thead><tr className={thClass}><th>Mount</th><th>Device</th><th>FS</th><th className="w-[34%]">Usage</th></tr></thead>
          <tbody>
            {snap.disks.map((d) => (
              <tr key={d.mount} className={tdClass}>
                <td className="font-mono text-[12.5px]">{d.mount}</td>
                <td className="truncate font-mono text-[12px] text-muted">{d.device}</td>
                <td className="text-muted">{d.fstype}</td>
                <td>
                  <div className="flex items-center gap-3">
                    <ProgressBar value={d.percent} tone={d.percent > 90 ? "danger" : d.percent > 80 ? "warning" : "primary"} className="h-1.5" />
                    <span className="tabular shrink-0 text-[12px] text-muted">{formatBytes(d.used)} / {formatBytes(d.total)}</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </GlassCard>
  );
}

export function NetworkSection({ stat, snap }: { stat: ServerStatic; snap: MetricsSnapshot }) {
  const byName = new Map(stat.interfaces.map((i) => [i.name, i]));
  return (
    <GlassCard className="min-w-0 pb-3">
      <CardHeader icon={<Network />} title="Network interfaces" />
      <div className="overflow-x-auto px-3">
        <table className="w-full min-w-[560px] border-separate border-spacing-0 text-[13px]">
          <thead><tr className={thClass}><th>Interface</th><th>Address</th><th>Link</th><th>↑ TX</th><th>↓ RX</th><th>Total RX / TX</th></tr></thead>
          <tbody>
            {snap.net.interfaces.map((n) => {
              const info = byName.get(n.name);
              return (
                <tr key={n.name} className={tdClass}>
                  <td className="font-mono text-[12.5px]">{n.name}</td>
                  <td className="max-w-[200px] truncate font-mono text-[12px] text-muted">{info?.addresses.join(", ") || info?.mac || "—"}</td>
                  <td className="text-muted">{formatLinkSpeed(info?.speed_mbps) ?? "—"}</td>
                  <td className="tabular">{formatBitRate(n.tx_bps)}</td>
                  <td className="tabular">{formatBitRate(n.rx_bps)}</td>
                  <td className="tabular text-muted">{formatBytes(n.rx_total)} / {formatBytes(n.tx_total)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </GlassCard>
  );
}
