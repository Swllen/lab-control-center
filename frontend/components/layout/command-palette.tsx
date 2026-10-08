"use client";

import { Command } from "cmdk";
import { Cpu, Folder, Moon, Plus, Server as ServerIcon, SquareTerminal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import type { ReactNode } from "react";
import { useServers } from "@/lib/hooks/queries";
import { NAV_ITEMS } from "./nav";

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const { data: servers } = useServers();
  const { resolvedTheme, setTheme } = useTheme();

  const run = (fn: () => void) => () => {
    onOpenChange(false);
    fn();
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Command palette"
      overlayClassName="fixed inset-0 z-50 bg-slate-900/20 backdrop-blur-[3px] dark:bg-black/45"
      contentClassName="glass-strong fixed left-1/2 top-[18vh] z-50 w-[calc(100vw-32px)] max-w-[620px] -translate-x-1/2 overflow-hidden rounded-[22px] animate-fade-in"
    >
      <Command.Input
        autoFocus
        placeholder="Search servers, pages, actions…"
        className="h-14 w-full border-b border-line bg-transparent px-5 text-[15px] outline-none placeholder:text-subtle"
      />
      <Command.List className="max-h-[52vh] overflow-y-auto p-2">
        <Command.Empty className="px-4 py-8 text-center text-[13px] text-muted">No results.</Command.Empty>

        {servers && servers.length > 0 ? (
          <Group heading="Servers">
            {servers.map((s) => (
              <Item key={`hw-${s.id}`} value={`server ${s.name} ${s.hostname} ${s.tags.join(" ")}`} onSelect={run(() => router.push(`/hardware?server=${s.id}`))} icon={<ServerIcon />} hint={s.hostname}>
                {s.name}
              </Item>
            ))}
            {servers.map((s) => (
              <Item key={`term-${s.id}`} value={`terminal ssh ${s.name}`} onSelect={run(() => router.push(`/terminals?server=${s.id}&new=1`))} icon={<SquareTerminal />}>
                Open terminal on {s.name}
              </Item>
            ))}
            {servers.map((s) => (
              <Item key={`files-${s.id}`} value={`files browse ${s.name}`} onSelect={run(() => router.push(`/files?server=${s.id}`))} icon={<Folder />}>
                Browse files on {s.name}
              </Item>
            ))}
          </Group>
        ) : null}

        <Group heading="Navigate">
          {NAV_ITEMS.map((n) => (
            <Item key={n.href} value={`go ${n.label}`} onSelect={run(() => router.push(n.href))} icon={<n.icon />} hint={`G ${n.shortcut.toUpperCase()}`}>
              {n.label}
            </Item>
          ))}
        </Group>

        <Group heading="Actions">
          <Item value="add server new" onSelect={run(() => router.push("/servers?new=1"))} icon={<Plus />}>
            Add server
          </Item>
          <Item value="hardware details" onSelect={run(() => router.push("/hardware"))} icon={<Cpu />}>
            Hardware details
          </Item>
          <Item value="toggle theme dark light" onSelect={run(() => setTheme(resolvedTheme === "dark" ? "light" : "dark"))} icon={<Moon />}>
            Toggle dark mode
          </Item>
        </Group>
      </Command.List>
    </Command.Dialog>
  );
}

function Group({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <Command.Group
      heading={heading}
      className="mb-1 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-[11.5px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-subtle"
    >
      {children}
    </Command.Group>
  );
}

function Item({
  children,
  icon,
  hint,
  value,
  onSelect,
}: {
  children: ReactNode;
  icon: ReactNode;
  hint?: string;
  value: string;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex h-10 cursor-default items-center gap-3 rounded-xl px-3 text-[13.5px] data-[selected=true]:bg-primary-soft [&_svg]:size-4 [&_svg]:text-muted"
    >
      {icon}
      <span className="flex-1 truncate">{children}</span>
      {hint ? <span className="text-[12px] text-subtle">{hint}</span> : null}
    </Command.Item>
  );
}
