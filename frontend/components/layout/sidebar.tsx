"use client";

import { Database, FlaskConical } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ProgressBar } from "@/components/ui/misc";
import { formatBytes } from "@/lib/format";
import { useMetricsSummary } from "@/lib/hooks/queries";
import { diskTotals } from "@/lib/metrics-derive";
import { cn, sum } from "@/lib/utils";
import { NAV_ITEMS } from "./nav";

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="glass sticky top-5 hidden h-[calc(100vh-40px)] w-[248px] shrink-0 flex-col rounded-[24px] p-4 lg:flex 3xl:w-[272px]">
      <Link href="/dashboard" className="mb-7 mt-2 flex items-center gap-3 px-2">
        <div className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-[#5b8cff] to-[#2a5ee8] text-white shadow-[0_8px_20px_-8px_rgb(47_107_255/0.8)]">
          <FlaskConical className="size-[22px]" strokeWidth={1.8} />
        </div>
        <div className="text-[16.5px] font-semibold leading-[1.15] tracking-[-0.015em]">
          Lab Server
          <br />
          Control Center
        </div>
      </Link>

      <nav className="flex flex-1 flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group relative flex h-11 items-center gap-3.5 rounded-xl px-3.5 text-[14.5px] transition-colors duration-150",
                active
                  ? "bg-primary-soft font-medium text-primary shadow-[0_1px_0_rgb(255_255_255/0.6)_inset]"
                  : "text-fg/80 hover:bg-tile hover:text-fg",
              )}
            >
              {active ? <span className="absolute inset-y-2.5 left-0 w-[3px] rounded-full bg-primary" /> : null}
              <Icon className={cn("size-[19px] stroke-[1.7]", active ? "text-primary" : "text-muted group-hover:text-fg")} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <LabStorage />
    </aside>
  );
}

function LabStorage() {
  const { data } = useMetricsSummary();
  const totals = (data ?? []).map((m) => diskTotals(m.latest)).filter((t) => t != null);
  const used = sum(totals.map((t) => t.used));
  const total = sum(totals.map((t) => t.total));
  const pct = total ? (100 * used) / total : 0;
  return (
    <div className="tile mt-4 rounded-2xl p-4">
      <div className="mb-3 flex items-center gap-3">
        <Database className="size-[20px] stroke-[1.6] text-muted" />
        <span className="text-[13.5px] font-medium">Lab Storage</span>
      </div>
      <ProgressBar value={pct} className="h-1.5" />
      <div className="tabular mt-2 flex justify-between text-[11.5px] text-muted">
        <span>{total ? `${formatBytes(used)} / ${formatBytes(total)}` : "No data yet"}</span>
        <span>{total ? `${Math.round(pct)}%` : ""}</span>
      </div>
    </div>
  );
}
