const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

/** Binary (1024-based) sizes labelled the way GPU/OS tools do: 256 GB, 8 TB. */
export function formatBytes(bytes: number | null | undefined, digits?: number): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  let value = Math.abs(bytes);
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const d = digits ?? (value >= 100 || unit === 0 ? 0 : value >= 10 ? 1 : 1);
  const text = value.toFixed(d).replace(/\.0$/, "");
  return `${bytes < 0 ? "-" : ""}${text} ${BYTE_UNITS[unit]}`;
}

/** Bytes/second -> network-style bits/second (decimal): 620 Mbps, 1.4 Gbps. */
export function formatBitRate(bytesPerSecond: number | null | undefined): string {
  if (bytesPerSecond == null || !Number.isFinite(bytesPerSecond)) return "—";
  const bits = bytesPerSecond * 8;
  const units = ["bps", "Kbps", "Mbps", "Gbps", "Tbps"];
  let value = bits;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const digits = value >= 100 || unit === 0 ? 0 : 1;
  return `${value.toFixed(digits).replace(/\.0$/, "")} ${units[unit]}`;
}

export function formatLinkSpeed(mbps: number | null | undefined): string | null {
  if (!mbps) return null;
  return mbps >= 1000 ? `${(mbps / 1000).toFixed(mbps % 1000 ? 1 : 0)} Gbps` : `${mbps} Mbps`;
}

export function formatUptime(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (totalMin > 0) return `${m}m`;
  return `${Math.max(1, Math.floor(ms / 1000))}s`;
}

export function formatRelative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const diff = now - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return "—";
  const s = Math.round(diff / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export function formatPercent(value: number | null | undefined, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

export function formatWatts(w: number | null | undefined): string {
  if (w == null) return "—";
  return w >= 1000 ? `${(w / 1000).toFixed(2)} kW` : `${Math.round(w)} W`;
}

/**
 * "NVIDIA H100 80GB HBM3" -> "NVIDIA H100", "NVIDIA A100-SXM4-80GB" -> "NVIDIA A100",
 * "NVIDIA RTX PRO 6000 Blackwell Max-Q Workstation Edition" -> "NVIDIA RTX PRO 6000 Blackwell".
 */
export function shortGpuName(name: string): string {
  const short = name
    .replace(/\s+(Max-Q|Workstation Edition|Server Edition|Generation)\b/gi, "")
    .replace(/[-\s](SXM\d?|PCIe|NVL|\d+\s?GB).*$/i, "")
    .trim();
  return short || name;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length >= 2 ? `${parts[0]![0]}${parts[1]![0]}` : name.slice(0, 2);
  return letters.toUpperCase();
}

/** Unix seconds -> "2026-10-07 14:03" in local time. */
export function formatDateTime(unixSeconds: number | null | undefined): string {
  if (unixSeconds == null) return "—";
  const d = new Date(unixSeconds * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function formatEta(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;
}

/** Bytes/second as a storage rate: "112 MB/s". */
export function formatByteRate(bps: number | null | undefined): string {
  if (!bps) return "—";
  return `${formatBytes(bps)}/s`;
}
