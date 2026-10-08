import { CircleCheck, CircleX } from "lucide-react";
import type { ConnectionTestResult } from "@/lib/types";
import { cn } from "@/lib/utils";

export function ConnectionTestResultView({ result }: { result: ConnectionTestResult }) {
  const facts = result.ok
    ? [
        ["Latency", result.latency_ms != null ? `${result.latency_ms} ms` : "—"],
        ["Host", result.hostname],
        ["OS", result.os_name],
        ["Kernel", result.kernel],
        ["Python", result.python],
        [
          "GPUs",
          result.gpu_count
            ? `${result.gpu_count} via ${result.has_pynvml ? "pynvml" : "nvidia-smi"}`
            : result.has_nvidia_smi
              ? "nvidia-smi present, no GPUs"
              : "none detected",
        ],
      ]
    : [];
  return (
    <div
      className={cn(
        "rounded-2xl border px-4 py-3 text-[13px] animate-fade-in",
        result.ok ? "border-success/25 bg-success-soft" : "border-danger/25 bg-danger-soft",
      )}
      role="status"
    >
      <div className={cn("flex items-center gap-2 font-medium", result.ok ? "text-success" : "text-danger")}>
        {result.ok ? <CircleCheck className="size-4" /> : <CircleX className="size-4" />}
        {result.ok ? "Connection successful" : "Connection failed"}
      </div>
      {result.ok ? (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          {facts.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd className="truncate">{v ?? "—"}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-1 break-words text-fg/80">{result.error}</p>
      )}
    </div>
  );
}
