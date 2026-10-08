import { Badge } from "@/components/ui/badge";
import type { JobStatus, TransferStatus } from "@/lib/types";

type AnyStatus = JobStatus | TransferStatus;

const TONE: Record<AnyStatus, "success" | "warning" | "danger" | "info" | "neutral"> = {
  queued: "warning",
  running: "success",
  transferring: "info",
  completed: "success",
  failed: "danger",
  canceled: "neutral",
};

export function StatusPill({ status }: { status: AnyStatus }) {
  return (
    <Badge tone={TONE[status]} className="rounded-lg px-2 capitalize">
      {status}
    </Badge>
  );
}

export function progressTone(status: AnyStatus): "primary" | "success" | "danger" | "neutral" {
  if (status === "completed") return "success";
  if (status === "failed") return "danger";
  if (status === "running" || status === "transferring") return "primary";
  return "neutral";
}
