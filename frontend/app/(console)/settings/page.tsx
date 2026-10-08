"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState, type ReactNode } from "react";
import { CardHeader, GlassCard } from "@/components/ui/card";
import { Kbd } from "@/components/ui/misc";
import { NAV_ITEMS } from "@/components/layout/nav";
import { AiSettings } from "@/components/settings/ai-settings";
import { useMe } from "@/lib/hooks/queries";
import { cn } from "@/lib/utils";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-line py-3.5 last:border-0">
      <span className="text-[13.5px] text-muted">{label}</span>
      <span className="text-[13.5px]">{children}</span>
    </div>
  );
}

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { data: user } = useMe();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const themes = [
    { id: "light", label: "Light", icon: Sun },
    { id: "dark", label: "Dark", icon: Moon },
    { id: "system", label: "System", icon: Monitor },
  ] as const;

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      <GlassCard className="pb-3">
        <CardHeader title="Appearance" />
        <div className="flex gap-3 px-6 pb-3">
          {themes.map((t) => (
            <button
              key={t.id}
              onClick={() => setTheme(t.id)}
              className={cn(
                "tile flex flex-1 flex-col items-center gap-2 rounded-2xl py-5 text-[13px] font-medium transition hover:bg-tile-hover",
                mounted && theme === t.id && "ring-2 ring-primary",
              )}
            >
              <t.icon className="size-5 text-primary" />
              {t.label}
            </button>
          ))}
        </div>
      </GlassCard>

      <GlassCard className="pb-3">
        <CardHeader title="Account" />
        <div className="px-6">
          <Row label="Username">{user?.username}</Row>
          <Row label="Display name">{user?.display_name}</Row>
          <Row label="Role"><span className="capitalize">{user?.role}</span></Row>
        </div>
      </GlassCard>

      <AiSettings isAdmin={user?.role === "admin"} />

      <GlassCard className="pb-3 xl:col-span-2">
        <CardHeader title="Keyboard shortcuts" />
        <div className="grid grid-cols-1 gap-x-10 px-6 md:grid-cols-2">
          <Row label="Command palette"><Kbd>⌘ / Ctrl</Kbd> <Kbd>K</Kbd></Row>
          {NAV_ITEMS.map((n) => (
            <Row key={n.href} label={`Go to ${n.label}`}>
              <Kbd>G</Kbd> <Kbd>{n.shortcut.toUpperCase()}</Kbd>
            </Row>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}
