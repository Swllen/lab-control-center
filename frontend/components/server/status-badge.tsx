import { LoaderCircle, Wifi, WifiOff, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ConnectionState } from "@/lib/types";

const CONFIG: Record<ConnectionState, { label: string; tone: "success" | "warning" | "danger" | "neutral"; icon: typeof Wifi }> = {
  online: { label: "Online", tone: "success", icon: Wifi },
  connecting: { label: "Connecting", tone: "warning", icon: LoaderCircle },
  offline: { label: "Offline", tone: "neutral", icon: WifiOff },
  error: { label: "Error", tone: "danger", icon: TriangleAlert },
};

export function StatusBadge({ state }: { state: ConnectionState | null | undefined }) {
  const cfg = CONFIG[state ?? "connecting"];
  const Icon = cfg.icon;
  return (
    <Badge tone={cfg.tone}>
      <Icon className={state === "connecting" || !state ? "animate-spin" : undefined} />
      {cfg.label}
    </Badge>
  );
}

export function StatusDot({ state }: { state: ConnectionState | null | undefined }) {
  const color =
    state === "online" ? "bg-success" : state === "error" ? "bg-danger" : state === "offline" ? "bg-subtle" : "bg-warning";
  return (
    <span className="relative inline-flex size-2.5">
      {state === "online" ? <span className="absolute inset-0 animate-ping rounded-full bg-success/50 [animation-duration:2.4s]" /> : null}
      <span className={`relative inline-flex size-2.5 rounded-full ${color}`} />
    </span>
  );
}
