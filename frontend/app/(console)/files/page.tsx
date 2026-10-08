"use client";

import { Folder } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { FileManager } from "@/components/files/file-manager";
import { GlassCard } from "@/components/ui/card";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { useServers } from "@/lib/hooks/queries";

function FilesPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { data, isLoading } = useServers();
  const servers = (data ?? []).filter((s) => s.transport === "ssh");

  if (isLoading) return <Skeleton className="h-[calc(100vh-150px)] rounded-[22px]" />;
  if (servers.length === 0) {
    return (
      <GlassCard>
        <EmptyState icon={<Folder />} title="No SSH servers" description="Add or import a server to browse its files." />
      </GlassCard>
    );
  }

  const requested = Number(params.get("server"));
  const serverId = servers.find((s) => s.id === requested)?.id ?? servers[0]!.id;
  const path = params.get("path") || "~";

  return (
    <FileManager
      servers={servers}
      serverId={serverId}
      path={path}
      onNavigate={(id, p) => router.push(`/files?server=${id}&path=${encodeURIComponent(p)}`)}
    />
  );
}

export default function FilesPage() {
  return (
    <Suspense>
      <FilesPageInner />
    </Suspense>
  );
}
