import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function GlassCard({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("glass rounded-[22px]", className)} {...props} />;
}

export function CardHeader({
  icon,
  title,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3 px-6 pb-3 pt-5", className)}>
      <div className="flex items-center gap-3 text-[16px] font-semibold tracking-[-0.01em]">
        {icon ? <span className="text-muted [&_svg]:size-[18px]">{icon}</span> : null}
        {title}
      </div>
      {action}
    </div>
  );
}
