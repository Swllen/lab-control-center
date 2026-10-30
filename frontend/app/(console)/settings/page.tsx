"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useEffect, useState, type ReactNode } from "react";
import { CardHeader, GlassCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { authApi, queryKeys } from "@/lib/api";
import { Kbd } from "@/components/ui/misc";
import { NAV_ITEMS } from "@/components/layout/nav";
import { AiSettings } from "@/components/settings/ai-settings";
import { LanAddress } from "@/components/settings/lan-address";
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
  const qc = useQueryClient();
  const [draft, setDraft] = useState<{ username: string; display_name: string } | null>(null);
  const profile = draft ?? { username: user?.username ?? "", display_name: user?.display_name ?? "" };
  const changed = !!user && (profile.username.trim() !== user.username || profile.display_name.trim() !== user.display_name);
  const saveProfile = useMutation({
    mutationFn: () => authApi.updateMe({ username: profile.username.trim(), display_name: profile.display_name.trim() }),
    onSuccess: (updated) => {
      qc.setQueryData(queryKeys.me, updated);
      setDraft(null);
      toast.success("Account updated");
    },
  });
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
        <form className="space-y-3 px-6" onSubmit={(e) => { e.preventDefault(); if (changed && profile.username.trim() && !saveProfile.isPending) saveProfile.mutate(); }}>
          <Field label="Username" htmlFor="account-username" hint="Use the new username the next time you sign in.">
            <Input id="account-username" autoComplete="username" required maxLength={64} value={profile.username} disabled={!user || saveProfile.isPending} onChange={(e) => { setDraft({ ...profile, username: e.target.value }); saveProfile.reset(); }} />
          </Field>
          <Field label="Display name" htmlFor="account-display-name">
            <Input id="account-display-name" autoComplete="nickname" maxLength={128} value={profile.display_name} disabled={!user || saveProfile.isPending} onChange={(e) => { setDraft({ ...profile, display_name: e.target.value }); saveProfile.reset(); }} />
          </Field>
          <Row label="Role"><span className="capitalize">{user?.role}</span></Row>
          {saveProfile.error ? <p role="alert" className="text-[13px] text-danger">{saveProfile.error.message}</p> : null}
          <div className="flex justify-end gap-2 pb-2">
            <Button type="button" variant="ghost" disabled={!changed || saveProfile.isPending} onClick={() => { setDraft(null); saveProfile.reset(); }}>Cancel</Button>
            <Button type="submit" disabled={!changed || !profile.username.trim() || saveProfile.isPending}>{saveProfile.isPending ? "Saving…" : "Save changes"}</Button>
          </div>
        </form>
      </GlassCard>

      <AiSettings isAdmin={user?.role === "admin"} />
      {user?.role === "admin" ? <LanAddress /> : null}

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
