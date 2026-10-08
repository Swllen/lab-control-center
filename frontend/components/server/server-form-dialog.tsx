"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plug, ServerCog } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { queryKeys, serversApi } from "@/lib/api";
import type { ConnectionTestResult, Server, ServerCreate } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ConnectionTestResultView } from "./connection-test-result";

interface FormState {
  name: string;
  hostname: string;
  port: string;
  username: string;
  key_path: string;
  tags: string;
  description: string;
  max_jobs: string;
  transport: "ssh" | "demo";
}

const EMPTY: FormState = {
  name: "",
  hostname: "",
  port: "22",
  username: "",
  key_path: "~/.ssh/id_ed25519",
  tags: "",
  description: "",
  max_jobs: "4",
  transport: "ssh",
};

function fromServer(s: Server): FormState {
  return {
    name: s.name,
    hostname: s.hostname,
    port: String(s.port),
    username: s.username,
    key_path: s.key_path ?? "",
    tags: s.tags.join(", "),
    description: s.description,
    max_jobs: String(s.max_jobs),
    transport: s.transport,
  };
}

function toPayload(f: FormState): ServerCreate {
  return {
    name: f.name.trim(),
    hostname: f.hostname.trim(),
    port: Number(f.port) || 22,
    username: f.username.trim(),
    key_path: f.key_path.trim() || null,
    tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean),
    description: f.description.trim(),
    max_jobs: Number(f.max_jobs) || 4,
    transport: f.transport,
  };
}

export function ServerFormDialog({
  open,
  onOpenChange,
  server,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server?: Server | null;
}) {
  const qc = useQueryClient();
  const editing = !!server;
  const [form, setForm] = useState<FormState>(EMPTY);
  const [test, setTest] = useState<ConnectionTestResult | null>(null);

  useEffect(() => {
    if (open) {
      setForm(server ? fromServer(server) : EMPTY);
      setTest(null);
    }
  }, [open, server]);

  const set = <K extends keyof FormState>(key: K) => (value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (key !== "description" && key !== "tags" && key !== "name") setTest(null);
  };

  const testMutation = useMutation({
    mutationFn: () =>
      server?.ssh_config_host ? serversApi.test(server.id) : serversApi.testUnsaved(toPayload(form)),
    onSuccess: setTest,
    onError: (err) => setTest({ ok: false, error: err.message, latency_ms: null, hostname: null, os_name: null, kernel: null, python: null, has_nvidia_smi: false, has_pynvml: false, gpu_count: 0 }),
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = toPayload(form);
      if (!server) return serversApi.create(payload);
      const { transport: _t, ...update } = payload;
      if (server.ssh_config_host) {
        const { name, tags, description, max_jobs } = update;
        return serversApi.update(server.id, { name, tags, description, max_jobs });
      }
      return serversApi.update(server.id, { ...update, key_path: update.key_path ?? "" });
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: queryKeys.servers });
      qc.invalidateQueries({ queryKey: queryKeys.summary });
      toast.success(editing ? `Saved ${saved.name}` : `Added ${saved.name}`);
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    saveMutation.mutate();
  };

  const isDemo = form.transport === "demo";
  const fromConfig = !!server?.ssh_config_host;
  const canTest = form.hostname.trim() && form.username.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[620px]">
        <DialogHeader
          icon={<ServerCog />}
          title={editing ? `Edit ${server.name}` : "Add server"}
          description="The control center connects over SSH using a key stored on this host. Keys never leave the backend."
        />
        <form onSubmit={submit} className="grid grid-cols-6 gap-x-4 gap-y-4">
          {fromConfig ? (
            <p className="col-span-6 rounded-2xl bg-primary-soft px-4 py-3 text-[13px] text-fg/80">
              Connects with <code className="font-mono">ssh {server.ssh_config_host}</code>. Hostname, user, port and key are read
              from <code className="font-mono">~/.ssh/config</code>; edit that file to change them.
            </p>
          ) : null}
          <Field label="Display name" htmlFor="srv-name" className="col-span-3">
            <Input id="srv-name" required placeholder="tyw-lab" value={form.name} onChange={(e) => set("name")(e.target.value)} />
          </Field>
          <Field label="Max concurrent jobs" htmlFor="srv-maxjobs" className="col-span-3">
            <Input id="srv-maxjobs" type="number" min={1} max={64} value={form.max_jobs} onChange={(e) => set("max_jobs")(e.target.value)} />
          </Field>
          <Field label="Hostname / IP" htmlFor="srv-host" className="col-span-4">
            <Input id="srv-host" disabled={fromConfig} required placeholder="192.168.1.10" value={form.hostname} onChange={(e) => set("hostname")(e.target.value)} className="font-mono" />
          </Field>
          <Field label="SSH port" htmlFor="srv-port" className="col-span-2">
            <Input id="srv-port" disabled={fromConfig} type="number" min={1} max={65535} value={form.port} onChange={(e) => set("port")(e.target.value)} className="font-mono" />
          </Field>
          <Field label="Username" htmlFor="srv-user" className="col-span-2">
            <Input id="srv-user" disabled={fromConfig} required placeholder="research" value={form.username} onChange={(e) => set("username")(e.target.value)} className="font-mono" />
          </Field>
          <Field
            label="Private key path"
            htmlFor="srv-key"
            className="col-span-4"
            hint="Path on the control-center host (inside ~/.ssh). Leave empty to use ssh-agent."
          >
            <Input id="srv-key" disabled={isDemo || fromConfig} placeholder="~/.ssh/id_ed25519" value={form.key_path} onChange={(e) => set("key_path")(e.target.value)} className="font-mono" />
          </Field>
          <Field label="Tags" htmlFor="srv-tags" className="col-span-6" hint="Comma separated, e.g. AI Training, H100">
            <Input id="srv-tags" placeholder="AI Training" value={form.tags} onChange={(e) => set("tags")(e.target.value)} />
          </Field>
          <Field label="Description" htmlFor="srv-desc" className="col-span-6">
            <Textarea id="srv-desc" rows={2} placeholder="Optional notes" value={form.description} onChange={(e) => set("description")(e.target.value)} />
          </Field>

          {!editing ? (
            <div className="col-span-6 flex items-center gap-2 text-[12.5px] text-muted">
              <span>Connection type</span>
              <div className="flex rounded-xl bg-track p-0.5">
                {(["ssh", "demo"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => set("transport")(t)}
                    className={cn(
                      "rounded-[10px] px-3 py-1 font-medium transition",
                      form.transport === t ? "bg-glass-strong text-fg shadow-tile" : "text-muted hover:text-fg",
                    )}
                  >
                    {t === "ssh" ? "SSH" : "Simulated"}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {test ? (
            <div className="col-span-6">
              <ConnectionTestResultView result={test} />
            </div>
          ) : null}

          <DialogFooter className="col-span-6 mt-1 justify-between">
            <Button variant="secondary" onClick={() => testMutation.mutate()} disabled={!canTest} loading={testMutation.isPending}>
              <Plug /> Test connection
            </Button>
            <div className="flex gap-2.5">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={saveMutation.isPending}>
                {editing ? "Save changes" : "Add server"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
