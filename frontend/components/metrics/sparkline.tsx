import { useId, useMemo } from "react";
import { cn } from "@/lib/utils";
import { TONE_COLOR, type MetricTone } from "./ring-gauge";

const W = 100;

/** Catmull-Rom spline through the points, expressed as cubic Béziers. */
function smoothPath(points: [number, number][]): string {
  if (points.length === 0) return "";
  const [first] = points;
  let d = `M${first![0].toFixed(2)},${first![1].toFixed(2)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
  }
  return d;
}

export function Sparkline({
  values,
  tone = "blue",
  max,
  height = 36,
  className,
  fill = true,
}: {
  values: number[];
  tone?: MetricTone;
  /** Fixed y-axis maximum (e.g. 100 for percentages). Auto-scales when omitted. */
  max?: number;
  height?: number;
  className?: string;
  fill?: boolean;
}) {
  const gradientId = useId();
  const color = TONE_COLOR[tone];

  const { line, area } = useMemo(() => {
    if (values.length < 2) return { line: "", area: "" };
    const hi = max ?? Math.max(...values) * 1.15;
    const lo = max != null ? 0 : Math.min(...values) * 0.85;
    const span = hi - lo || 1;
    const pad = 3;
    const pts = values.map(
      (v, i) => [(i / (values.length - 1)) * W, pad + (1 - (v - lo) / span) * (height - pad * 2)] as [number, number],
    );
    const l = smoothPath(pts);
    return { line: l, area: `${l} L${W},${height} L0,${height} Z` };
  }, [values, max, height]);

  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none"
      className={cn("block w-full overflow-visible", className)}
      style={{ height }}
      aria-hidden
    >
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.22} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {line ? (
        <>
          {fill ? <path d={area} fill={`url(#${gradientId})`} /> : null}
          <path d={line} fill="none" stroke={color} strokeWidth={1.75} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </>
      ) : (
        <line x1="0" x2={W} y1={height - 4} y2={height - 4} stroke="var(--track)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeDasharray="3 4" />
      )}
    </svg>
  );
}
