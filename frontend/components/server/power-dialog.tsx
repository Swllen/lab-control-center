"use client";

import { useMutation } from "@tanstack/react-query";
import { Power, RotateCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { serversApi } from "@/lib/api";
import type { PowerActionName, Server } from "@/lib/types";

const COPY: Record<PowerActionName, { title: string; verb: string; body: string }> = {
  reboot: {
    title: "Restart",
    verb: "Restart server",
    body: "Running jobs, terminals and transfers on this machine will be interrupted.",
  },
  poweroff: {
    title: "Shut down",
    verb: "Shut down server",
    body: "The machine will power off. Someone will need physical or IPMI access to start it again.",
  },
};

export function PowerDialog({
  server,
  action,
  onOpenChange,
}: {
  server: Server;
  action: PowerActionName | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [confirm, setConfirm] = useState("");
  const mutation = useMutation({
    mutationFn: (a: PowerActionName) => serversApi.power(server.id, a, confirm),
    onSuccess: (_, a) => {
      toast.success(`${COPY[a].title} requested for ${server.name}`);
      close();
    },
    onError: (err) => toast.error(err.message),
  });
  const close = () => {
    setConfirm("");
    onOpenChange(false);
  };
  if (!action) return null;
  const copy = COPY[action];
  const matches = confirm === server.name;

  return (
    <Dialog open={!!action} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-md">
        <DialogHeader
          tone="danger"
          icon={action === "reboot" ? <RotateCw /> : <Power />}
          title={`${copy.title} ${server.name}?`}
          description={copy.body}
        />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (matches) mutation.mutate(action);
          }}
        >
          <Field
            htmlFor="power-confirm"
            label={`Type the server name to confirm`}
            hint={
              <>
                Runs <code className="font-mono">sudo -n systemctl {action}</code> on {server.hostname}.
              </>
            }
          >
            <Input
              id="power-confirm"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              placeholder={server.name}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="font-mono"
            />
          </Field>
          <DialogFooter>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" variant="danger-solid" disabled={!matches} loading={mutation.isPending}>
              {copy.verb}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
