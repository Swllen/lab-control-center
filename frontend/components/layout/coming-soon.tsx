import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { GlassCard } from "@/components/ui/card";

export function ComingSoon({
  icon,
  phase,
  title,
  description,
  features,
  children,
}: {
  icon: ReactNode;
  phase: number;
  title: string;
  description: string;
  features: string[];
  children?: ReactNode;
}) {
  return (
    <GlassCard className="flex flex-col items-center px-8 py-16 text-center animate-fade-in">
      <div className="mb-5 grid size-14 place-items-center rounded-2xl bg-primary-soft text-primary [&_svg]:size-7">{icon}</div>
      <span className="mb-3 rounded-full bg-track px-3 py-1 text-[12px] font-medium text-muted">Planned · Phase {phase}</span>
      <h2 className="text-[20px] font-semibold tracking-[-0.015em]">{title}</h2>
      <p className="mt-2 max-w-lg text-[14px] leading-relaxed text-muted">{description}</p>
      <ul className="mt-7 grid max-w-2xl grid-cols-1 gap-x-8 gap-y-2.5 text-left text-[13.5px] sm:grid-cols-2">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2.5">
            <Check className="mt-0.5 size-4 shrink-0 text-success" />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      {children}
    </GlassCard>
  );
}
