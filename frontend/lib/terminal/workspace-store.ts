/**
 * Terminal workspace layout: tabs -> slots -> panes. Persisted to localStorage so the arrangement
 * (and backend session ids, for reattaching after a refresh) survives reloads.
 *
 * Pure state only; side effects (creating/closing backend sessions) live in components.
 */
"use client";

import { useSyncExternalStore } from "react";

export type Layout = "1x1" | "1x2" | "2x2";

export const SLOT_COUNT: Record<Layout, number> = { "1x1": 1, "1x2": 2, "2x2": 4 };
const GROW: Record<Layout, Layout | null> = { "1x1": "1x2", "1x2": "2x2", "2x2": null };

export interface PaneState {
  id: string;
  serverId: number;
  name: string;
  /** Backend terminal session id; null until created (or after the shell is gone). */
  sessionId: string | null;
  /** Alternate login account (~/.ssh/config alias); absent/null = the server's own login. */
  account?: string | null;
  username?: string | null;
}

export interface PaneAccount {
  account: string;
  username: string | null;
}

export interface TabState {
  id: string;
  title: string;
  layout: Layout;
  slots: (string | null)[];
  maximized: string | null;
}

export interface Workspace {
  version: 1;
  tabs: TabState[];
  activeTabId: string;
  panes: Record<string, PaneState>;
  /** Pane that should own keyboard focus. */
  focusedPaneId?: string | null;
}

const STORAGE_KEY = "lcc.terminal-workspace.v1";

const uid = () => Math.random().toString(36).slice(2, 10);

function newTab(index: number): TabState {
  return { id: uid(), title: `Workspace ${index}`, layout: "1x1", slots: [null], maximized: null };
}

function initial(): Workspace {
  const tab = newTab(1);
  return { version: 1, tabs: [tab], activeTabId: tab.id, panes: {} };
}

function isWorkspace(v: unknown): v is Workspace {
  const w = v as Workspace;
  return !!w && w.version === 1 && Array.isArray(w.tabs) && w.tabs.length > 0 && typeof w.panes === "object";
}

function load(): Workspace {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (isWorkspace(parsed)) {
      if (!parsed.tabs.some((t) => t.id === parsed.activeTabId)) parsed.activeTabId = parsed.tabs[0]!.id;
      return parsed;
    }
  } catch {
    /* corrupted or unavailable storage */
  }
  return initial();
}

// ---------------------------------------------------------------- external store

let state: Workspace | null = null;
const listeners = new Set<() => void>();
const SERVER_SNAPSHOT = initial();

function current(): Workspace {
  if (state === null) state = load();
  return state;
}

function commit(next: Workspace): void {
  state = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode: keep in memory */
  }
  listeners.forEach((l) => l());
}

function update(fn: (w: Workspace) => Workspace): void {
  commit(fn(current()));
}

export function useWorkspace(): Workspace {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    current,
    () => SERVER_SNAPSHOT,
  );
}

export function getWorkspace(): Workspace {
  return current();
}

// ---------------------------------------------------------------- helpers

function replaceTab(w: Workspace, tab: TabState): Workspace {
  return { ...w, tabs: w.tabs.map((t) => (t.id === tab.id ? tab : t)) };
}

function resizeSlots(slots: (string | null)[], count: number): (string | null)[] {
  return Array.from({ length: count }, (_, i) => slots[i] ?? null);
}

export function nextSessionName(w: Workspace, serverId: number, base = "shell"): string {
  const taken = new Set(Object.values(w.panes).filter((p) => p.serverId === serverId).map((p) => p.name));
  for (let i = 1; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

// ---------------------------------------------------------------- actions

export const workspace = {
  /** Place a new pane in the active tab: first free slot, else grow the layout, else a new tab. */
  openPane(serverId: number, name?: string, tabId?: string, login?: PaneAccount | null): string {
    const paneId = uid();
    update((w) => {
      const pane: PaneState = {
        id: paneId,
        serverId,
        name: name ?? nextSessionName(w, serverId, login?.username ?? "shell"),
        sessionId: null,
        account: login?.account ?? null,
        username: login?.username ?? null,
      };
      let tab = w.tabs.find((t) => t.id === (tabId ?? w.activeTabId)) ?? w.tabs[0]!;
      let tabs = w.tabs;
      let free = tab.slots.indexOf(null);
      if (free === -1 && GROW[tab.layout]) {
        const layout = GROW[tab.layout]!;
        tab = { ...tab, layout, slots: resizeSlots(tab.slots, SLOT_COUNT[layout]) };
        free = tab.slots.indexOf(null);
      }
      if (free === -1) {
        tab = newTab(w.tabs.length + 1);
        tabs = [...tabs, tab];
        free = 0;
      }
      const slots = [...tab.slots];
      slots[free] = paneId;
      tab = { ...tab, slots, maximized: null };
      tabs = tabs.some((t) => t.id === tab.id) ? tabs.map((t) => (t.id === tab.id ? tab : t)) : [...tabs, tab];
      return { ...w, tabs, activeTabId: tab.id, panes: { ...w.panes, [paneId]: pane }, focusedPaneId: paneId };
    });
    return paneId;
  },

  /** Open a pane in a specific empty slot. */
  openInSlot(tabId: string, slot: number, serverId: number, login?: PaneAccount | null): string {
    const paneId = uid();
    update((w) => {
      const tab = w.tabs.find((t) => t.id === tabId);
      if (!tab || tab.slots[slot] !== null) return w;
      const slots = [...tab.slots];
      slots[slot] = paneId;
      const pane: PaneState = {
        id: paneId,
        serverId,
        name: nextSessionName(w, serverId, login?.username ?? "shell"),
        sessionId: null,
        account: login?.account ?? null,
        username: login?.username ?? null,
      };
      return { ...replaceTab(w, { ...tab, slots }), panes: { ...w.panes, [paneId]: pane }, focusedPaneId: paneId };
    });
    return paneId;
  },

  duplicatePane(paneId: string): string | null {
    const w = current();
    const pane = w.panes[paneId];
    const tab = w.tabs.find((t) => t.slots.includes(paneId));
    if (!pane || !tab) return null;
    const login = pane.account ? { account: pane.account, username: pane.username ?? null } : null;
    return workspace.openPane(pane.serverId, nextSessionName(w, pane.serverId, pane.name.replace(/-\d+$/, "")), tab.id, login);
  },

  closePane(paneId: string): void {
    update((w) => {
      const { [paneId]: _removed, ...panes } = w.panes;
      const tabs = w.tabs.map((t) =>
        t.slots.includes(paneId)
          ? { ...t, slots: t.slots.map((s) => (s === paneId ? null : s)), maximized: t.maximized === paneId ? null : t.maximized }
          : t,
      );
      return { ...w, tabs, panes };
    });
  },

  focusPane(paneId: string): void {
    if (current().focusedPaneId !== paneId) update((w) => ({ ...w, focusedPaneId: paneId }));
  },

  setSession(paneId: string, sessionId: string | null): void {
    update((w) => (w.panes[paneId] ? { ...w, panes: { ...w.panes, [paneId]: { ...w.panes[paneId]!, sessionId } } } : w));
  },

  renamePane(paneId: string, name: string): void {
    update((w) => (w.panes[paneId] ? { ...w, panes: { ...w.panes, [paneId]: { ...w.panes[paneId]!, name } } } : w));
  },

  /** Change layout; panes that no longer fit move to a new tab. Returns how many moved. */
  setLayout(tabId: string, layout: Layout): number {
    let moved = 0;
    update((w) => {
      const tab = w.tabs.find((t) => t.id === tabId);
      if (!tab) return w;
      const count = SLOT_COUNT[layout];
      const occupied = tab.slots.filter((s): s is string => s !== null);
      const keep = occupied.slice(0, count);
      const overflow = occupied.slice(count);
      moved = overflow.length;
      const slots = resizeSlots(keep, count);
      let tabs = w.tabs.map((t) => (t.id === tabId ? { ...t, layout, slots, maximized: null } : t));
      if (overflow.length) {
        const extraLayout: Layout = overflow.length === 1 ? "1x1" : overflow.length === 2 ? "1x2" : "2x2";
        const extra = { ...newTab(w.tabs.length + 1), layout: extraLayout, slots: resizeSlots(overflow, SLOT_COUNT[extraLayout]) };
        tabs = [...tabs, extra];
      }
      return { ...w, tabs };
    });
    return moved;
  },

  toggleMaximize(tabId: string, paneId: string): void {
    update((w) => {
      const tab = w.tabs.find((t) => t.id === tabId);
      return tab ? replaceTab(w, { ...tab, maximized: tab.maximized === paneId ? null : paneId }) : w;
    });
  },

  addTab(): void {
    update((w) => {
      const tab = newTab(w.tabs.length + 1);
      return { ...w, tabs: [...w.tabs, tab], activeTabId: tab.id };
    });
  },

  /** Removes the tab and returns its pane ids so the caller can close their sessions. */
  closeTab(tabId: string): PaneState[] {
    const w = current();
    const tab = w.tabs.find((t) => t.id === tabId);
    if (!tab) return [];
    const closing = tab.slots.flatMap((id) => (id && w.panes[id] ? [w.panes[id]!] : []));
    update((ws) => {
      const panes = { ...ws.panes };
      closing.forEach((p) => delete panes[p.id]);
      let tabs = ws.tabs.filter((t) => t.id !== tabId);
      if (tabs.length === 0) tabs = [newTab(1)];
      const idx = ws.tabs.findIndex((t) => t.id === tabId);
      const activeTabId = ws.activeTabId === tabId ? tabs[Math.max(0, idx - 1)]!.id : ws.activeTabId;
      return { ...ws, tabs, panes, activeTabId };
    });
    return closing;
  },

  renameTab(tabId: string, title: string): void {
    update((w) => {
      const tab = w.tabs.find((t) => t.id === tabId);
      return tab ? replaceTab(w, { ...tab, title }) : w;
    });
  },

  activateTab(tabId: string): void {
    update((w) => (w.tabs.some((t) => t.id === tabId) ? { ...w, activeTabId: tabId } : w));
  },
};
