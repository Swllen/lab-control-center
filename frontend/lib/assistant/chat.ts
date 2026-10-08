"use client";

import { api, backendUrl } from "@/lib/api/client";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  /** User message was sent with the terminal's recent output attached. */
  attached?: boolean;
  error?: boolean;
}

export interface AssistantStatus {
  configured: boolean;
  key_source: "env" | "file" | "none";
  model: string;
  base_url: string;
  thinking: boolean;
  /** Known endpoints by region id ("international", "china"). */
  presets: Record<string, string>;
}

export const assistantApi = {
  status: () => api<AssistantStatus>("/api/assistant/status"),
  setKey: (apiKey: string) => api<void>("/api/assistant/key", { method: "PUT", body: { api_key: apiKey } }),
  removeKey: () => api<void>("/api/assistant/key", { method: "DELETE" }),
};

/**
 * Stream a reply (NDJSON from the backend, called directly so the dev proxy cannot buffer it).
 * Calls `onDelta` with each text fragment; throws on errors.
 */
export async function streamChat(
  body: {
    messages: { role: "user" | "assistant"; content: string }[];
    server_id: number | null;
    account: string | null;
    terminal_output: string | null;
    model?: string | null;
    thinking?: boolean | null;
  },
  onDelta: (text: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch(backendUrl("/api/assistant/chat"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const detail = await res.json().catch(() => null);
    throw new Error((detail as { detail?: string } | null)?.detail ?? `HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const frame = JSON.parse(line) as { delta?: string; done?: boolean; error?: string };
      if (frame.error) throw new Error(frame.error);
      if (frame.delta) onDelta(frame.delta);
      if (frame.done) return;
    }
  }
}

// ---------------------------------------------------------------- models / per-user preferences

/** GLM text models offered in the UI. Any other model id can still be typed in Settings. */
export const AI_MODELS: { id: string; note: string }[] = [
  { id: "glm-4.5-air", note: "均衡 · 有专属额度" },
  { id: "glm-4.6v", note: "多模态 · 有专属额度" },
  { id: "glm-4.7-flash", note: "更快 · 用通用额度" },
  { id: "glm-4.7", note: "更强 · 用通用额度" },
  { id: "glm-5", note: "最强 · 用通用额度，消耗大" },
];

export interface AssistantPrefs {
  /** null = use the default from Settings */
  model: string | null;
  thinking: boolean | null;
}

const PREFS_KEY = "lcc.assistant.prefs.v1";

export function loadPrefs(): AssistantPrefs {
  try {
    const p = JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<AssistantPrefs>;
    return { model: p.model ?? null, thinking: p.thinking ?? null };
  } catch {
    return { model: null, thinking: null };
  }
}

export function savePrefs(prefs: AssistantPrefs): void {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* storage unavailable */
  }
}

// ---------------------------------------------------------------- persisted history

const HISTORY_KEY = "lcc.assistant.history.v1";
const MAX_SAVED = 60;

export function loadHistory(): ChatMessage[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(HISTORY_KEY) ?? "[]");
    return Array.isArray(parsed) ? (parsed as ChatMessage[]) : [];
  } catch {
    return [];
  }
}

export function saveHistory(messages: ChatMessage[]): void {
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(messages.slice(-MAX_SAVED)));
  } catch {
    /* storage unavailable */
  }
}

/** Commands that deserve a warning before the user runs them. */
const RISKY = /(\brm\s+-[a-zA-Z]*[rf]|\bsudo\b|\bmkfs|\bdd\s+if=|\bshutdown\b|\breboot\b|\bkill(all)?\b|\bpkill\b|\bchmod\s+-R|\bchown\s+-R|>\s*\/dev\/(sd|nvme)|\bgit\s+push\s+.*--force|\btruncate\b|:\(\)\s*\{)/;

export function isRisky(command: string): boolean {
  return RISKY.test(command);
}
