import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { TONE_COLOR, type MetricTone } from "./ring-gauge";

const ICON_TONE: Record<MetricTone, string> = {
  blue: "text-primary",
  violet: "text-violet",
  green: "text-success",
  amber: "text-warning",
  red: "text-danger",
};

/** The white rounded tile used for every metric on server cards. */
export function MetricTile({
  icon,
  iconTone = "blue",
  title,
  subtitle,
  children,
  footer,
  dimmed,
  className,
}: {
  icon: ReactNode;
  iconTone?: MetricTone;
  title: string;
  subtitle?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  dimmed?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "tile group/tile flex min-w-0 flex-col justify-center rounded-2xl px-4 py-3.5 transition-[background-color,opacity] duration-300 hover:bg-tile-hover",
        dimmed && "opacity-55 saturate-50",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className={cn("shrink-0 [&_svg]:size-[22px] [&_svg]:stroke-[1.6]", ICON_TONE[iconTone])}>{icon}</div>
        <div className="min-w-0 max-w-[60%] shrink-0 grow">
          <p className="truncate text-[14px] font-semibold leading-tight">{title}</p>
          {subtitle ? (
            <p className="tabular mt-0.5 truncate text-[12.5px] text-muted" title={typeof subtitle === "string" ? subtitle : undefined}>
              {subtitle}
            </p>
          ) : null}
        </div>
        {children}
      </div>
      {footer ? <div className="mt-2.5 min-w-0">{footer}</div> : null}
    </div>
  );
}

/** Tiny per-device bars (one per GPU), e.g. utilization of each card. */
export function MiniBars({
  values,
  tone = "green",
  labels,
  className,
}: {
  values: number[];
  tone?: MetricTone;
  labels?: string[];
  className?: string;
}) {
  return (
    <div className={cn("flex h-5 items-end gap-[3px]", className)}>
      {values.map((v, i) => (
        <div
          key={i}
          title={labels?.[i] ?? `GPU ${i}: ${Math.round(v)}%`}
          className="relative h-full w-[7px] overflow-hidden rounded-[3px] bg-track"
        >
          <div
            className="absolute inset-x-0 bottom-0 rounded-[3px] transition-[height] duration-700 ease-out"
            style={{ height: `${Math.max(Math.min(v, 100), 4)}%`, background: TONE_COLOR[tone] }}
          />
        </div>
      ))}
    </div>
  );
}
