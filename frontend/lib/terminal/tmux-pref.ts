/** "Use tmux" preference for newly opened terminals, persisted to localStorage. */
"use client";

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "lcc.terminal.tmux";

let value: boolean | null = null;
const listeners = new Set<() => void>();

export function getTmuxPref(): boolean {
  if (value === null) {
    try {
      value = window.localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      value = false;
    }
  }
  return value;
}

export function setTmuxPref(next: boolean): void {
  value = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  } catch {
    /* storage unavailable: keep in memory */
  }
  listeners.forEach((l) => l());
}

export function useTmuxPref(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getTmuxPref,
    () => false,
  );
}
