"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, FileText } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { queryKeys, serversApi } from "@/lib/api";
import { cn } from "@/lib/utils";

export function ImportSshConfigDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const qc = useQueryClient();
  const hosts = useQuery({ queryKey: ["ssh-config"], queryFn: serversApi.sshConfigHosts, enabled: open });
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Preselect everything not imported yet, skipping aliases that point at an already-selected HostName.
  useEffect(() => {
    if (!open || !hosts.data) return;
    const seen = new Set<string>();
    const initial = new Set<string>();
    for (const h of hosts.data) {
      if (h.imported_as == null && !seen.has(h.hostname)) initial.add(h.alias);
      seen.add(h.hostname);
    }
    setSelected(initial);
  }, [open, hosts.data]);

  const importMutation = useMutation({
    mutationFn: () => serversApi.importSshConfig([...selected]),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: queryKeys.servers });
      qc.invalidateQueries({ queryKey: queryKeys.summary });
      qc.invalidateQueries({ queryKey: ["ssh-config"] });
      toast.success(`Imported ${created.length} server${created.length === 1 ? "" : "s"}`);
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const toggle = (alias: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(alias)) next.delete(alias);
      else next.add(alias);
      return next;
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader
          icon={<FileText />}
          title="Import from SSH config"
          description={
            <>
              Hosts from <code className="font-mono">~/.ssh/config</code> on the control-center machine. Connections use
              the config as-is (HostName, User, IdentityFile, ProxyJump).
            </>
          }
        />
        {hosts.isLoading ? (
          <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : !hosts.data?.length ? (
          <EmptyState icon={<FileText />} title="No hosts found" description="~/.ssh/config is missing or only contains wildcard entries." />
        ) : (
          <ul className="flex flex-col gap-2">
            {hosts.data.map((h) => {
              const imported = h.imported_as != null;
              const checked = imported || selected.has(h.alias);
              return (
                <li key={h.alias}>
                  <button
                    type="button"
                    disabled={imported}
                    onClick={() => toggle(h.alias)}
                    className={cn(
                      "tile flex w-full items-center gap-3.5 rounded-2xl px-4 py-3 text-left transition",
                      imported ? "opacity-60" : "hover:bg-tile-hover",
                      checked && !imported && "ring-2 ring-primary/50",
                    )}
                  >
                    <span
                      className={cn(
                        "grid size-5 shrink-0 place-items-center rounded-md border transition",
                        checked ? "border-primary bg-primary text-white" : "border-line bg-glass-strong",
                      )}
                    >
                      {checked ? <Check className="size-3.5" strokeWidth={3} /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-semibold">{h.alias}</span>
                      <span className="block truncate font-mono text-[12px] text-muted">
                        {h.user ? `${h.user}@` : ""}{h.hostname}{h.port !== 22 ? `:${h.port}` : ""}
                        {h.proxy_jump ? ` via ${h.proxy_jump}` : ""}
                      </span>
                    </span>
                    <span className="text-[12px] text-subtle">{imported ? "Already added" : h.identity_file ?? "default key"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" disabled={selected.size === 0} loading={importMutation.isPending} onClick={() => importMutation.mutate()}>
            Import {selected.size || ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
