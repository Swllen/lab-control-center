"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Bell, CircleCheck, LogOut, Moon, Search, Settings, Sun, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/misc";
import { authApi } from "@/lib/api";
import { initials } from "@/lib/format";
import { useMe, useMetricsSummary, useServerMap } from "@/lib/hooks/queries";
import { cn } from "@/lib/utils";
import { navForPath } from "./nav";

export function Topbar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const pathname = usePathname();
  const nav = navForPath(pathname);
  return (
    <header className="mb-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-4 px-1 pt-3">
      <div className="min-w-0">
        <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.025em] 3xl:text-[32px]">{nav.title}</h1>
        <p className="mt-1 text-[14.5px] text-muted">{nav.subtitle}</p>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onOpenPalette}
          className="glass flex h-11 w-[340px] max-w-[42vw] items-center gap-3 rounded-2xl px-4 text-left text-[13.5px] text-subtle shadow-none transition hover:bg-glass-strong"
        >
          <Search className="size-[18px] text-muted" />
          <span className="flex-1 truncate">Search servers, jobs, files…</span>
          <Kbd>⌘ K</Kbd>
        </button>
        <ThemeToggle />
        <Notifications />
        <UserMenu />
      </div>
    </header>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === "dark";
  return (
    <Button
      variant="secondary"
      size="icon"
      className="size-11"
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      {dark ? <Moon className="text-primary" /> : <Sun className="text-primary" />}
    </Button>
  );
}

function Notifications() {
  const { data } = useMetricsSummary();
  const servers = useServerMap();
  const issues = (data ?? []).filter((m) => m.status.state === "offline" || m.status.state === "error");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative size-11" aria-label="Notifications">
          <Bell className="size-[19px]" />
          {issues.length ? (
            <span className="absolute right-2.5 top-2.5 size-2 rounded-full bg-danger ring-2 ring-[var(--bg)]" />
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-80">
        <DropdownMenuLabel>Notifications</DropdownMenuLabel>
        {issues.length === 0 ? (
          <div className="flex items-center gap-2.5 px-2.5 py-3 text-[13px] text-muted">
            <CircleCheck className="size-4 text-success" /> All servers are healthy
          </div>
        ) : (
          issues.map((m) => (
            <DropdownMenuItem key={m.server_id} asChild>
              <Link href={`/servers`} className="items-start">
                <TriangleAlert className="mt-0.5 !text-danger" />
                <div className="min-w-0">
                  <p className="font-medium">{servers.get(m.server_id)?.name ?? `Server ${m.server_id}`} is {m.status.state}</p>
                  <p className="line-clamp-2 text-[12px] text-muted">{m.status.error}</p>
                </div>
              </Link>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu() {
  const { data: user } = useMe();
  const router = useRouter();
  const qc = useQueryClient();
  const name = user?.display_name || user?.username || "…";
  const logout = async () => {
    await authApi.logout().catch(() => undefined);
    qc.clear();
    router.replace("/login");
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="flex items-center gap-3 rounded-2xl py-1 pl-1 pr-2 text-left transition hover:bg-tile">
          <span className="grid size-10 place-items-center rounded-full bg-gradient-to-br from-slate-300 to-slate-400 text-[13px] font-semibold text-white dark:from-slate-600 dark:to-slate-700">
            {initials(name)}
          </span>
          <span className="hidden leading-tight xl:block">
            <span className="block text-[14px] font-medium">{name}</span>
            <span className={cn("block text-[12px] capitalize text-muted")}>{user?.role ?? ""} · Research Lab</span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>Signed in as {user?.username}</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings /> Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={logout}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
