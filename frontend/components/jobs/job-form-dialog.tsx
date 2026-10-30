"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  requested_gpu_indices?: number[] | null;
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
  const [gpuMode, setGpuMode] = useState<"auto" | "specific">("auto");
  const [selectedGpus, setSelectedGpus] = useState<number[]>([]);
  const capabilities = useQuery({ queryKey: ["scheduler", "gpu-selection"], queryFn: jobsApi.queueStatus, enabled: open, staleTime: 5000, refetchInterval: open ? 10_000 : false });
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
    setGpuMode(base.requested_gpu_indices?.length ? "specific" : "auto");
    setSelectedGpus(base.requested_gpu_indices ?? []);
    setPreview(null);
    setPreviewError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const { env, error: envError } = useMemo(() => parseEnv(envText), [envText]);
  const gpuCount = useMemo(
    () => summary?.find((m) => m.server_id === serverId)?.static?.gpus.length ?? 8,
    [summary, serverId],
  );
  const gpuOptions = summary?.find((m) => m.server_id === serverId)?.static?.gpus ?? [];
  const supportsSelection = capabilities.data?.find(s => s.server_id === serverId)?.supports_gpu_selection;
  const selectionError = gpuMode !== "specific" ? null : !supportsSelection
    ? "Restart the updated backend to enable specific GPU selection."
    : !gpuOptions.length ? "Waiting for GPU information from the server."
    : !selectedGpus.length ? "Select at least one GPU."
    : selectedGpus.some(index => !gpuOptions.some(g => g.index === index)) ? "A selected GPU is no longer available on this server. Select again." : null;
  const spec: JobSpec | null = serverId ? {
    server_id: serverId, working_dir: workingDir.trim() || "~", command, env,
    gpus: gpuMode === "specific" ? selectedGpus.length : gpus,
    requested_gpu_indices: gpuMode === "specific" ? selectedGpus : null,
  } : null;

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
  }, [open, mode, paramsYaml, command, name, serverId, workingDir, gpus, envText, gpuMode, selectedGpus]);

  const submit = useMutation({
    mutationFn: async (): Promise<Job[]> => {
      if (!spec) throw new Error("Pick a server");
      if (envError) throw new Error(envError);
      if (selectionError) throw new Error(selectionError);
      try {
        window.localStorage.setItem(LAST_KEY, JSON.stringify({ server_id: spec.server_id, working_dir: spec.working_dir, env, gpus: spec.gpus, requested_gpu_indices: spec.requested_gpu_indices }));
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
          <Field label="GPUs" htmlFor="job-gpus" className="col-span-6 sm:col-span-3" hint={gpuMode === "specific" ? `${selectedGpus.length} GPU${selectedGpus.length === 1 ? "" : "s"} selected` : gpus ? `CUDA_VISIBLE_DEVICES gets ${gpus} idle GPU${gpus > 1 ? "s" : ""}` : "CPU only (GPUs hidden)"}>
            <div className="flex items-center gap-2">
              <Button size="icon-sm" type="button" disabled={gpuMode === "specific"} aria-label="Fewer GPUs" onClick={() => setGpus((g) => Math.max(0, g - 1))}><Minus /></Button>
              <Input id="job-gpus" type="number" disabled={gpuMode === "specific"} min={0} max={16} value={gpuMode === "specific" ? selectedGpus.length : gpus} onChange={(e) => setGpus(Math.max(0, Math.min(16, Number(e.target.value) || 0)))} className="w-20 text-center" />
              <Button size="icon-sm" type="button" disabled={gpuMode === "specific"} aria-label="More GPUs" onClick={() => setGpus((g) => Math.min(gpuCount, g + 1))}><Plus /></Button>
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
                  onClick={() => { if (serverId !== s.id) { setSelectedGpus([]); } setServerId(s.id); }}
                  className={cn("tile flex items-center gap-2 rounded-xl px-3.5 py-2 text-[13px] font-medium transition hover:bg-tile-hover", serverId === s.id && "ring-2 ring-primary")}
                >
                  <StatusDot state={summary?.find((m) => m.server_id === s.id)?.status.state} />
                  {s.name}
                </button>
              ))}
            </div>
          </div>
          <div className="col-span-6 space-y-3">
            <div className="flex gap-2" role="group" aria-label="GPU allocation">
              <Button type="button" size="sm" variant={gpuMode === "auto" ? "primary" : "secondary"} aria-pressed={gpuMode === "auto"} onClick={() => setGpuMode("auto")}>Auto-assign</Button>
              <Button type="button" size="sm" variant={gpuMode === "specific" ? "primary" : "secondary"} aria-pressed={gpuMode === "specific"} onClick={() => setGpuMode("specific")}>Select GPUs</Button>
            </div>
            {gpuMode === "specific" ? <>
              <div className="flex flex-wrap gap-2">{gpuOptions.map(g => <button key={g.index} type="button" aria-pressed={selectedGpus.includes(g.index)} title={g.name}
                onClick={() => setSelectedGpus(ids => ids.includes(g.index) ? ids.filter(id => id !== g.index) : [...ids, g.index].sort((a, b) => a - b))}
                className={cn("tile rounded-xl px-4 py-2 text-sm transition", selectedGpus.includes(g.index) && "ring-2 ring-primary text-primary")}>
                GPU {g.index}
              </button>)}</div>
              <p className="text-xs text-muted">Uses only the selected GPUs and waits until all are idle. GPU numbering inside your program starts at 0.</p>
              {selectionError ? <p role="alert" className="text-xs text-danger">{selectionError}</p> : null}
            </> : null}
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
            <Button type="submit" variant="primary" loading={submit.isPending} disabled={!spec || !!envError || !!selectionError || (mode === "sweep" && !preview)}>
              {mode === "job" ? "Queue job" : preview ? `Queue ${preview.count} jobs` : "Queue sweep"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
