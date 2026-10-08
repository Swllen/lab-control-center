"use client";

import { Cpu, TriangleAlert } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { ServerPicker } from "@/components/hardware/server-picker";
import { CpuSection, DisksSection, GpuSection, MemorySection, NetworkSection, SystemOverview } from "@/components/hardware/sections";
import { StatusBadge } from "@/components/server/status-badge";
import { GlassCard } from "@/components/ui/card";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { useServers } from "@/lib/hooks/queries";
import { useServerMetrics } from "@/lib/hooks/use-server-metrics";

function HardwareDetail({ serverId }: { serverId: number }) {
  const live = useServerMetrics(serverId);
  const { static: stat, latest: snap, history, status } = live;

  if (!stat || !snap) {
    if (status && (status.state === "offline" || status.state === "error")) {
      return (
        <GlassCard>
          <EmptyState icon={<TriangleAlert />} title="No telemetry available" description={status.error ?? "The server is unreachable."} />
        </GlassCard>
      );
    }
    return (
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-72 rounded-[22px]" />)}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      <div className="flex items-center gap-3">
        <StatusBadge state={status?.state} />
        {status?.error ? <span className="text-[13px] text-danger">{status.error}</span> : null}
      </div>
      <SystemOverview stat={stat} snap={snap} />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <CpuSection stat={stat} snap={snap} history={history} />
        <MemorySection snap={snap} history={history} />
      </div>
      <GpuSection stat={stat} snap={snap} history={history} />
      <div className="grid grid-cols-1 gap-5 2xl:grid-cols-2">
        <DisksSection snap={snap} />
        <NetworkSection stat={stat} snap={snap} />
      </div>
    </div>
  );
}

function HardwarePageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { data: servers, isLoading } = useServers();

  if (isLoading) return <Skeleton className="h-12 w-72 rounded-2xl" />;
  if (!servers?.length) {
    return (
      <GlassCard>
        <EmptyState icon={<Cpu />} title="No servers" description="Add a server to see detailed hardware telemetry." />
      </GlassCard>
    );
  }

  const requested = Number(params.get("server"));
  const selected = servers.find((s) => s.id === requested)?.id ?? servers[0]!.id;

  return (
    <div className="flex flex-col gap-5">
      <ServerPicker servers={servers} value={selected} onChange={(id) => router.replace(`/hardware?server=${id}`)} />
      <HardwareDetail key={selected} serverId={selected} />
    </div>
  );
}

export default function HardwarePage() {
  return (
    <Suspense>
      <HardwarePageInner />
    </Suspense>
  );
}
