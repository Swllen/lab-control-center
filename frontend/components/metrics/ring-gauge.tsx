import { cn } from "@/lib/utils";

export type MetricTone = "blue" | "violet" | "green" | "amber" | "red";

export const TONE_COLOR: Record<MetricTone, string> = {
  blue: "var(--primary)",
  violet: "var(--violet)",
  green: "var(--success)",
  amber: "var(--warning)",
  red: "var(--danger)",
};

export function RingGauge({
  value,
  tone = "blue",
  size = 56,
  stroke = 5,
  label,
  className,
}: {
  value: number | null;
  tone?: MetricTone;
  size?: number;
  stroke?: number;
  label?: string;
  className?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = value == null ? 0 : Math.min(Math.max(value, 0), 100);
  return (
    <div className={cn("relative shrink-0", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--track)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={TONE_COLOR[tone]}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct / 100)}
          style={{ transition: "stroke-dashoffset 700ms cubic-bezier(.3,.7,.2,1), stroke 300ms" }}
        />
      </svg>
      <span className="tabular absolute inset-0 grid place-items-center text-[13px] font-semibold tracking-[-0.02em]">
        {label ?? (value == null ? "—" : `${Math.round(pct)}%`)}
      </span>
    </div>
  );
}

/** Pick a warmer tone as utilization approaches saturation. */
export function toneForLoad(value: number | null | undefined, base: MetricTone): MetricTone {
  if (value == null) return base;
  if (value >= 95) return "red";
  if (value >= 88) return "amber";
  return base;
}
