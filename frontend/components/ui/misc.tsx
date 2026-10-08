import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-line bg-tile px-1.5",
        "font-sans text-[11px] font-medium text-subtle",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded-lg", className)} />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-primary-soft text-primary [&_svg]:size-6">
        {icon}
      </div>
      <p className="text-[15px] font-semibold">{title}</p>
      {description ? <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-muted">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function ProgressBar({
  value,
  tone = "primary",
  className,
}: {
  value: number;
  tone?: "primary" | "success" | "warning" | "danger" | "neutral";
  className?: string;
}) {
  const color = {
    primary: "bg-gradient-to-r from-[#5b8cff] to-primary",
    success: "bg-gradient-to-r from-[#3fcf76] to-success",
    warning: "bg-warning",
    danger: "bg-danger",
    neutral: "bg-subtle/40",
  }[tone];
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-track", className)}>
      <div
        className={cn("h-full rounded-full transition-[width] duration-700 ease-out", color)}
        style={{ width: `${Math.min(Math.max(value, 0), 100)}%` }}
      />
    </div>
  );
}
