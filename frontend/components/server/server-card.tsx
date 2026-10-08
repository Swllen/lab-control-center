"use client";

import { useMutation } from "@tanstack/react-query";
import {
  Copy,
  Cpu,
  EllipsisVertical,
  Folder,
  Pencil,
  Plug,
  Power,
  RotateCw,
  Server as ServerIcon,
  Square,
  SquareTerminal,
  Terminal,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { serversApi } from "@/lib/api";
import { formatUptime } from "@/lib/format";
import { useServerMetrics } from "@/lib/hooks/use-server-metrics";
import type { PowerActionName, Server } from "@/lib/types";
import { copyToClipboard } from "@/lib/utils";
import { PowerDialog } from "./power-dialog";
import { ServerFormDialog } from "./server-form-dialog";
import { ServerMetricsGrid } from "./server-metrics-grid";
import { StatusBadge, StatusDot } from "./status-badge";

export function sshCommand(s: Server): string {
  if (s.ssh_config_host) return `ssh ${s.ssh_config_host}`;
  return `ssh ${s.port !== 22 ? `-p ${s.port} ` : ""}${s.username}@${s.hostname}`;
}

export function ServerCard({ server }: { server: Server }) {
  const router = useRouter();
  const live = useServerMetrics(server.id);
  const [power, setPower] = useState<PowerActionName | null>(null);
  const [editing, setEditing] = useState(false);

  const state = live.status?.state ?? "connecting";
  const unhealthy = state === "offline" || state === "error";
  const os = live.static?.os_name.replace(/\s+LTS$/, "").replace(/(\d+\.\d+)\.\d+/, "$1");
  const subtitle = [server.hostname, os, ...server.tags].filter(Boolean);

  const test = useMutation({
    mutationFn: () => serversApi.test(server.id),
    onSuccess: (r) =>
      r.ok ? toast.success(`${server.name} reachable`, { description: `${r.latency_ms} ms · ${r.os_name}` }) : toast.error(`${server.name}: ${r.error}`),
    onError: (e) => toast.error(e.message),
  });

  const openNative = async () => {
    const cmd = sshCommand(server);
    const ok = await copyToClipboard(cmd);
    toast(ok ? "SSH command copied" : "SSH command", { description: cmd });
  };

  return (
    <section className="glass flex min-w-0 flex-col rounded-[24px] p-5 animate-fade-in 3xl:p-6" aria-label={server.name}>
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="grid size-[52px] shrink-0 place-items-center rounded-2xl bg-gradient-to-b from-white to-slate-100 text-slate-600 shadow-tile ring-1 ring-black/[0.04] dark:from-slate-700 dark:to-slate-800 dark:text-slate-300">
          <ServerIcon className="size-6" strokeWidth={1.7} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="truncate text-[21px] font-semibold tracking-[-0.02em]">{server.name}</h2>
            <StatusBadge state={live.status?.state} />
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[13px] text-muted">
            {subtitle.map((part, i) => (
              <span key={i} className="flex items-center gap-2">
                {i > 0 ? <span className="text-subtle">•</span> : null}
                <span className={i === 0 ? "tabular" : undefined}>{part}</span>
              </span>
            ))}
          </p>
        </div>
        <div className="hidden shrink-0 items-start gap-2.5 pt-0.5 sm:flex">
          <span className="mt-[18px]"><StatusDot state={state} /></span>
          <div className="leading-tight">
            <p className="text-[12.5px] text-muted">Uptime</p>
            <p className="tabular mt-0.5 text-[15px] font-semibold">{live.latest && !unhealthy ? formatUptime(live.latest.uptime_s) : "—"}</p>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${server.name}`}>
              <EllipsisVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={() => router.push(`/hardware?server=${server.id}`)}><Cpu /> Hardware details</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => test.mutate()}><Plug /> Test connection</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setEditing(true)}><Pencil /> Edit server</DropdownMenuItem>
            <DropdownMenuItem onSelect={openNative}><Copy /> Copy SSH command</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem tone="danger" onSelect={() => setPower("reboot")}><RotateCw /> Restart…</DropdownMenuItem>
            <DropdownMenuItem tone="danger" onSelect={() => setPower("poweroff")}><Power /> Shut down…</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Actions */}
      <div className="mb-5 mt-5 flex flex-wrap gap-2.5">
        <Button variant="primary" className="min-w-[112px]" onClick={() => router.push(`/terminals?server=${server.id}&new=1`)}>
          <Terminal /> SSH
        </Button>
        <Button onClick={openNative} title="Copy the ssh command for your local terminal">
          <SquareTerminal /> Open in Terminal
        </Button>
        <Button onClick={() => router.push(`/files?server=${server.id}`)}>
          <Folder /> Files
        </Button>
        <Button onClick={() => setPower("reboot")} disabled={unhealthy}>
          <RotateCw /> Restart
        </Button>
        <Button variant="danger" onClick={() => setPower("poweroff")} disabled={unhealthy}>
          <Square className="fill-current" /> Stop
        </Button>
      </div>

      {/* Problem banner */}
      {unhealthy ? (
        <div className="mb-3 flex items-start gap-3 rounded-2xl border border-danger/20 bg-danger-soft px-4 py-3 text-[13px] animate-fade-in">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-danger">{state === "offline" ? "Server unreachable" : "Monitoring error"}</p>
            <p className="mt-0.5 break-words text-fg/75">{live.status?.error ?? "Unknown error"}</p>
          </div>
          <Button size="sm" variant="secondary" loading={test.isPending} onClick={() => test.mutate()}>
            Test
          </Button>
        </div>
      ) : null}

      <ServerMetricsGrid live={live} dimmed={unhealthy} />

      <PowerDialog server={server} action={power} onOpenChange={(o) => !o && setPower(null)} />
      <ServerFormDialog open={editing} onOpenChange={setEditing} server={server} />
      <Link href={`/hardware?server=${server.id}`} className="sr-only">Hardware details for {server.name}</Link>
    </section>
  );
}
