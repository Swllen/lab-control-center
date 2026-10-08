"use client";

import { ArrowLeftRight, ArrowRight, FileText, ListChecks, Plus, Server } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { JobsTable } from "@/components/jobs/jobs-table";
import { ImportSshConfigDialog } from "@/components/server/import-ssh-config-dialog";
import { ServerCard } from "@/components/server/server-card";
import { ServerFormDialog } from "@/components/server/server-form-dialog";
import { TransfersTable } from "@/components/transfers/transfers-table";
import { Button } from "@/components/ui/button";
import { CardHeader, GlassCard } from "@/components/ui/card";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { useJobs, useServers } from "@/lib/hooks/queries";
import { useTransfersLive } from "@/lib/hooks/use-transfers-live";

function ViewAll({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="tile flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12.5px] font-medium text-primary transition hover:bg-tile-hover"
    >
      View All <ArrowRight className="size-3.5" />
    </Link>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const servers = useServers();
  const jobs = useJobs(5);
  const transfers = useTransfersLive(5);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      {servers.isLoading ? (
        <div className="grid grid-cols-1 gap-6 2xl:grid-cols-2">
          {[0, 1].map((i) => <Skeleton key={i} className="h-[470px] rounded-[24px]" />)}
        </div>
      ) : servers.data?.length ? (
        <div className="grid grid-cols-1 gap-6 2xl:grid-cols-2 3xl:grid-cols-3">
          {servers.data.map((s) => <ServerCard key={s.id} server={s} />)}
        </div>
      ) : (
        <GlassCard>
          <EmptyState
            icon={<Server />}
            title="No servers yet"
            description="Add a Linux server reachable over SSH to start monitoring CPU, GPU, memory, disks and network in real time."
            action={
              <div className="flex gap-2.5">
                <Button variant="primary" onClick={() => setImporting(true)}><FileText /> Import from SSH config</Button>
                <Button onClick={() => setAdding(true)}><Plus /> Add manually</Button>
              </div>
            }
          />
        </GlassCard>
      )}

      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[1.12fr_1fr]">
        <GlassCard className="min-w-0 pb-3">
          <CardHeader icon={<ListChecks />} title="Recent Jobs / Queue" action={<ViewAll href="/jobs" />} />
          <div className="px-3"><JobsTable jobs={jobs.data} loading={jobs.isLoading} onOpen={(j) => router.push(`/jobs?job=${j.id}`)} /></div>
        </GlassCard>
        <GlassCard className="min-w-0 pb-3">
          <CardHeader icon={<ArrowLeftRight />} title="Recent File Transfers" action={<ViewAll href="/transfers" />} />
          <div className="px-3"><TransfersTable transfers={transfers.data} loading={transfers.isLoading} /></div>
        </GlassCard>
      </div>

      <ServerFormDialog open={adding} onOpenChange={setAdding} />
      <ImportSshConfigDialog open={importing} onOpenChange={setImporting} />
    </div>
  );
}
