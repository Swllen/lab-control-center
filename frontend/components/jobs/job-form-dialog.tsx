"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Layers, ListChecks, Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { StatusDot } from "@/components/server/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { jobsApi, sweepsApi } from "@/lib/api";
import { useMetricsSummary } from "@/lib/hooks/queries";
import type { Job, JobSpec, Server, SweepPreview } from "@/lib/types";
import { cn } from "@/lib/utils";

export type JobFormMode = "job" | "sweep";

export interface JobFormInitial {
  name?: string;
  server_id?: number;
  working_dir?: string;
  command?: string;
  env?: Record<string, string>;
  gpus?: number;
}

const LAST_KEY = "lcc.jobs.last-spec";
const EXAMPLE_SWEEP = `parameters:
  learning_rate:
    - 1e-4
    - 3e-4
    - 1e-3
  batch_size:
    - 4
    - 8
`;

function envToText(env: Record<string, string> = {}): string {
  return Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n");
}

function parseEnv(text: string): { env: Record<string, string>; error: string | null } {
  const env: Record<string, string> = {};
  for (const [i, raw] of text.split("\n").entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) return { env, error: `Line ${i + 1}: expected KEY=VALUE` };
    const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return { env, error: `Line ${i + 1}: invalid name "${key}"` };
    env[key] = line.slice(eq + 1);
  }
  return { env, error: null };
}

function loadLast(): JobFormInitial {
  try {
    return JSON.parse(window.localStorage.getItem(LAST_KEY) ?? "{}") as JobFormInitial;
  } catch {
    return {};
  }
}

export function JobFormDialog({
  open,
  onOpenChange,
  mode: initialMode,
  initial,
  servers,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  mode: JobFormMode;
  initial?: JobFormInitial | null;
  servers: Server[];
}) {
  const qc = useQueryClient();
  const { data: summary } = useMetricsSummary();
  const shells = servers.filter((s) => s.transport === "ssh");
  const [mode, setMode] = useState<JobFormMode>(initialMode);
  const [name, setName] = useState("");
  const [serverId, setServerId] = useState<number | null>(null);
  const [workingDir, setWorkingDir] = useState("~");
  const [command, setCommand] = useState("");
  const [envText, setEnvText] = useState("");
  const [gpus, setGpus] = useState(0);
  const [paramsYaml, setParamsYaml] = useState(EXAMPLE_SWEEP);
  const [preview, setPreview] = useState<SweepPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const base = initial ?? loadLast();
    setMode(initialMode);
    setName(initial?.name ?? "");
    setServerId(base.server_id && shells.some((s) => s.id === base.server_id) ? base.server_id : shells[0]?.id ?? null);
    setWorkingDir(base.working_dir ?? "~");
    setCommand(initial?.command ?? "");
    setEnvText(envToText(base.env));
    setGpus(base.gpus ?? 0);
    setPreview(null);
    setPreviewError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const { env, error: envError } = useMemo(() => parseEnv(envText), [envText]);
  const gpuCount = useMemo(
    () => summary?.find((m) => m.server_id === serverId)?.static?.gpus.length ?? 8,
    [summary, serverId],
  );
  const spec: JobSpec | null = serverId ? { server_id: serverId, working_dir: workingDir.trim() || "~", command, env, gpus } : null;

  // Live sweep preview (debounced).
  useEffect(() => {
    if (!open || mode !== "sweep" || !spec || !command.trim() || !name.trim()) {
      setPreview(null);
      return;
    }
    const t = setTimeout(() => {
      sweepsApi.preview({ ...spec, name: name.trim(), parameters_yaml: paramsYaml }).then(
        (p) => {
          setPreview(p);
          setPreviewError(null);
        },
        (e: Error) => {
          setPreview(null);
          setPreviewError(e.message);
        },
      );
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, paramsYaml, command, name, serverId, workingDir, gpus, envText]);

  const submit = useMutation({
    mutationFn: async (): Promise<Job[]> => {
      if (!spec) throw new Error("Pick a server");
      if (envError) throw new Error(envError);
      try {
        window.localStorage.setItem(LAST_KEY, JSON.stringify({ server_id: spec.server_id, working_dir: spec.working_dir, env, gpus }));
      } catch {
        /* ignore */
      }
      if (mode === "job") return [await jobsApi.create({ ...spec, name: name.trim() })];
      return sweepsApi.create({ ...spec, name: name.trim(), parameters_yaml: paramsYaml });
    },
    onSuccess: (jobs) => {
      void qc.invalidateQueries({ queryKey: ["jobs"] });
      void qc.invalidateQueries({ queryKey: ["scheduler"] });
      toast.success(jobs.length === 1 ? `Queued ${jobs[0]!.name}` : `Queued ${jobs.length} jobs`);
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[760px]">
        <DialogHeader
          icon={mode === "job" ? <ListChecks /> : <Layers />}
          title={mode === "job" ? "New job" : "New parameter sweep"}
          description="Queued jobs start when the requested GPUs are idle. Output goes to ~/.lcc/jobs/<id>/ on the server."
        />
        <div className="mb-4 flex w-fit rounded-xl bg-track p-0.5 text-[13px]">
          {(["job", "sweep"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn("rounded-[10px] px-3.5 py-1.5 font-medium transition", mode === m ? "bg-glass-strong shadow-tile" : "text-muted hover:text-fg")}
            >
              {m === "job" ? "Single job" : "Sweep"}
            </button>
          ))}
        </div>
        <form onSubmit={onSubmit} className="grid grid-cols-6 gap-x-4 gap-y-4">
          <Field label={mode === "job" ? "Name" : "Sweep name (prefix)"} htmlFor="job-name" className="col-span-6 sm:col-span-3">
            <Input id="job-name" required autoFocus placeholder="finetune-llama" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="GPUs" htmlFor="job-gpus" className="col-span-6 sm:col-span-3" hint={gpus ? `CUDA_VISIBLE_DEVICES gets ${gpus} idle GPU${gpus > 1 ? "s" : ""}` : "CPU only (GPUs hidden)"}>
            <div className="flex items-center gap-2">
              <Button size="icon-sm" type="button" aria-label="Fewer GPUs" onClick={() => setGpus((g) => Math.max(0, g - 1))}><Minus /></Button>
              <Input id="job-gpus" type="number" min={0} max={16} value={gpus} onChange={(e) => setGpus(Math.max(0, Math.min(16, Number(e.target.value) || 0)))} className="w-20 text-center" />
              <Button size="icon-sm" type="button" aria-label="More GPUs" onClick={() => setGpus((g) => Math.min(gpuCount, g + 1))}><Plus /></Button>
              <span className="text-[12px] text-subtle">of {gpuCount}</span>
            </div>
          </Field>
          <div className="col-span-6 flex flex-col gap-1.5">
            <span className="text-[12.5px] font-medium text-muted">Server</span>
            <div className="flex flex-wrap gap-2">
              {shells.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setServerId(s.id)}
                  className={cn("tile flex items-center gap-2 rounded-xl px-3.5 py-2 text-[13px] font-medium transition hover:bg-tile-hover", serverId === s.id && "ring-2 ring-primary")}
                >
                  <StatusDot state={summary?.find((m) => m.server_id === s.id)?.status.state} />
                  {s.name}
                </button>
              ))}
            </div>
          </div>
          <Field label="Working directory" htmlFor="job-wd" className="col-span-6">
            <Input id="job-wd" value={workingDir} onChange={(e) => setWorkingDir(e.target.value)} className="font-mono" spellCheck={false} />
          </Field>
          <Field
            label="Command"
            htmlFor="job-cmd"
            className="col-span-6"
            hint={
              mode === "sweep" ? (
                <>Use <code className="font-mono">{"{param}"}</code> placeholders; parameters not referenced are appended as <code className="font-mono">--param=value</code>.</>
              ) : (
                <>Runs with <code className="font-mono">bash -l</code>. Write a 0–1 value or “42%” to <code className="font-mono">$LCC_PROGRESS_FILE</code> to report progress.</>
              )
            }
          >
            <Textarea
              id="job-cmd"
              required
              rows={4}
              spellCheck={false}
              placeholder={mode === "sweep" ? "conda activate llm && python train.py --lr {learning_rate}" : "conda activate llm && python train.py --config configs/base.yaml"}
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              className="font-mono text-[12.5px]"
            />
          </Field>
          <Field label="Environment variables" htmlFor="job-env" className={cn("col-span-6", mode === "sweep" && "sm:col-span-3")} error={envError} hint="One KEY=VALUE per line">
            <Textarea id="job-env" rows={mode === "sweep" ? 8 : 3} spellCheck={false} placeholder={"WANDB_PROJECT=llama\nHF_HOME=/storage20/hf"} value={envText} onChange={(e) => setEnvText(e.target.value)} className="font-mono text-[12.5px]" />
          </Field>
          {mode === "sweep" ? (
            <Field label="Parameters (YAML)" htmlFor="job-params" className="col-span-6 sm:col-span-3" error={previewError}>
              <Textarea id="job-params" rows={8} spellCheck={false} value={paramsYaml} onChange={(e) => setParamsYaml(e.target.value)} className="font-mono text-[12.5px]" />
            </Field>
          ) : null}
          {mode === "sweep" && preview ? (
            <div className="col-span-6 rounded-2xl bg-track/70 px-4 py-3 animate-fade-in">
              <p className="mb-2 text-[12.5px] font-medium">
                {preview.count} job{preview.count === 1 ? "" : "s"} · {Object.entries(preview.parameters).map(([k, v]) => `${k} × ${v.length}`).join(" · ")}
              </p>
              <ul className="max-h-36 space-y-1 overflow-auto font-mono text-[11.5px] text-muted">
                {preview.jobs.map((j) => (
                  <li key={j.name} className="truncate" title={j.command}>
                    <span className="text-fg/80">{j.name}</span> — {j.command}
                  </li>
                ))}
                {preview.count > preview.jobs.length ? <li>… {preview.count - preview.jobs.length} more</li> : null}
              </ul>
            </div>
          ) : null}
          <DialogFooter className="col-span-6 mt-1">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={submit.isPending} disabled={!spec || !!envError || (mode === "sweep" && !preview)}>
              {mode === "job" ? "Queue job" : preview ? `Queue ${preview.count} jobs` : "Queue sweep"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
