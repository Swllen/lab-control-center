"use client";

import "@xterm/xterm/css/xterm.css";
import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { terminalsApi, wsUrl } from "@/lib/api";
import { registerTerminal } from "@/lib/terminal/registry";
import { getWorkspace, workspace } from "@/lib/terminal/workspace-store";
import { TERMINAL_FONT, TERMINAL_THEME } from "./theme";

export type ConnState = "connecting" | "connected" | "disconnected" | "exited" | "error";

export interface XtermHandle {
  /** Reattach to the running shell, or start a new one if it has exited. */
  reconnect: () => void;
  focus: () => void;
}

interface Props {
  paneId: string;
  /** Give this terminal keyboard focus (on mount once ready, and whenever it turns true). */
  focused: boolean;
  onState: (state: ConnState, detail?: string) => void;
  onFocus: () => void;
}

// One in-flight creation per pane, so StrictMode double-mounts don't spawn two shells.
const creating = new Map<string, Promise<string>>();

function ensureSession(paneId: string, cols: number, rows: number, fresh: boolean): Promise<string> {
  const pane = getWorkspace().panes[paneId];
  if (!pane) return Promise.reject(new Error("Pane was closed"));
  if (pane.sessionId && !fresh) return Promise.resolve(pane.sessionId);
  let pending = creating.get(paneId);
  if (!pending) {
    pending = terminalsApi
      .create({
        server_id: pane.serverId,
        name: pane.name,
        cols,
        rows,
        account: pane.account ?? null,
        // Re-creating a tmux pane (after a backend restart or exit) reattaches to the same tmux session.
        tmux: !!pane.tmux,
        tmux_session: pane.tmuxSession ?? null,
      })
      .then((s) => {
        workspace.setSession(paneId, s.id, s.tmux);
        return s.id;
      })
      .finally(() => creating.delete(paneId));
    creating.set(paneId, pending);
  }
  return pending;
}

export const XtermView = forwardRef<XtermHandle, Props>(function XtermView({ paneId, focused, onState, onFocus }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const connectRef = useRef<(fresh: boolean) => void>(() => undefined);
  const exitedRef = useRef(false);
  const callbacks = useRef({ onState, onFocus });
  callbacks.current = { onState, onFocus };
  const focusedRef = useRef(focused);
  focusedRef.current = focused;

  useEffect(() => {
    if (focused) termRef.current?.focus();
  }, [focused]);

  useImperativeHandle(ref, () => ({
    reconnect: () => connectRef.current(exitedRef.current || !getWorkspace().panes[paneId]?.sessionId),
    focus: () => termRef.current?.focus(),
  }));

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let term: Terminal | null = null;
    let fit: FitAddon | null = null;
    let ws: WebSocket | null = null;
    let retry = 0;
    let freshAttempts = 0;
    let unregister: () => void = () => undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const encoder = new TextEncoder();
    const setState = (s: ConnState, detail?: string) => !disposed && callbacks.current.onState(s, detail);

    const send = (data: Uint8Array | string) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(data);
    };
    const sendResize = () => term && send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));

    const safeFit = () => {
      if (!fit || !container.offsetWidth || !container.offsetHeight) return;
      try {
        fit.fit();
      } catch {
        /* renderer not ready */
      }
    };

    const connect = (fresh: boolean) => {
      if (!term || disposed) return;
      clearTimeout(retryTimer);
      const old = ws;
      ws = null;
      old?.close();
      exitedRef.current = false;
      setState("connecting");

      ensureSession(paneId, term.cols, term.rows, fresh)
        .then((sessionId) => {
          if (disposed || !term) return;
          const sock = new WebSocket(wsUrl(`/ws/terminals/${sessionId}`));
          sock.binaryType = "arraybuffer";
          ws = sock;

          sock.onopen = () => {
            retry = 0;
            term?.reset(); // the server replays scrollback right after attach
            sendResize();
            setState("connected");
          };
          sock.onmessage = (ev: MessageEvent<ArrayBuffer | string>) => {
            if (typeof ev.data !== "string") {
              term?.write(new Uint8Array(ev.data));
              return;
            }
            try {
              const frame = JSON.parse(ev.data) as { type: string; state?: string; exit_status?: number | null; error?: string | null };
              if (frame.type === "status" && frame.state === "closed") {
                exitedRef.current = true;
                workspace.setSession(paneId, null);
                const code = frame.exit_status != null ? ` with code ${frame.exit_status}` : "";
                term?.write(`\r\n\x1b[2m[${frame.error ?? `process exited${code}`} — press Enter to restart]\x1b[0m\r\n`);
                setState("exited", frame.error ?? `exit ${frame.exit_status ?? "?"}`);
              }
            } catch {
              /* ignore */
            }
          };
          sock.onclose = (ev) => {
            if (ws !== sock || disposed) return;
            ws = null;
            if (exitedRef.current) return;
            if (ev.code === 4401) return setState("error", "Not authenticated");
            if (ev.code === 4404 && freshAttempts < 2) {
              // Session no longer exists (backend restart / reaped): start a new shell.
              freshAttempts += 1;
              workspace.setSession(paneId, null);
              return connect(true);
            }
            retry += 1;
            setState("disconnected", `retrying in ${Math.min(2 ** retry, 15)}s`);
            retryTimer = setTimeout(() => connect(false), Math.min(1000 * 2 ** retry, 15000));
          };
        })
        .catch((err: unknown) => setState("error", err instanceof Error ? err.message : "Failed to start shell"));
    };
    connectRef.current = (fresh) => {
      freshAttempts = 0;
      connect(fresh);
    };

    const resizeObserver = new ResizeObserver(() => requestAnimationFrame(safeFit));

    (async () => {
      const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("@xterm/addon-web-links"),
      ]);
      if (disposed) return;
      term = new Terminal({
        theme: TERMINAL_THEME,
        fontFamily: TERMINAL_FONT,
        fontSize: 13,
        lineHeight: 1.15,
        cursorBlink: true,
        cursorStyle: "bar",
        scrollback: 10000,
        allowProposedApi: true,
        macOptionIsMeta: true,
        rightClickSelectsWord: true,
      });
      termRef.current = term;
      const t = term;
      unregister = registerTerminal(paneId, {
        recentOutput: (lines) => {
          const buf = t.buffer.active;
          const end = buf.baseY + buf.cursorY;
          const out: string[] = [];
          for (let i = Math.max(0, end - lines + 1); i <= end; i++) out.push(buf.getLine(i)?.translateToString(true) ?? "");
          while (out.length && !out[out.length - 1]!.trim()) out.pop();
          return out.join("\n");
        },
        insert: (text) => {
          t.paste(text.replace(/\s+$/, ""));
          t.focus();
        },
        focus: () => t.focus(),
      });
      fit = new FitAddon();
      term.loadAddon(fit);
      term.loadAddon(new WebLinksAddon());
      term.open(container);
      try {
        const { WebglAddon } = await import("@xterm/addon-webgl");
        if (!disposed) {
          const gl = new WebglAddon();
          gl.onContextLoss(() => gl.dispose()); // falls back to the DOM renderer
          term.loadAddon(gl);
        }
      } catch {
        /* WebGL unavailable */
      }

      // Windows Terminal style: Ctrl+C copies when text is selected (otherwise it is SIGINT),
      // Ctrl+V pastes. Paste is left to the browser's native paste event, which xterm turns into
      // input exactly once; reading the clipboard here as well would paste twice.
      term.attachCustomKeyEventHandler((e) => {
        if (e.type !== "keydown" || !e.ctrlKey || e.altKey || e.metaKey) return true;
        if (e.code === "KeyC" && term?.hasSelection()) {
          e.preventDefault();
          void navigator.clipboard.writeText(term.getSelection());
          term.clearSelection(); // the next Ctrl+C interrupts again
          return false;
        }
        if (e.code === "KeyV") return false; // let the browser fire `paste`
        return true;
      });
      term.onData((d) => {
        if (exitedRef.current) {
          if (d === "\r") connectRef.current(true);
          return;
        }
        send(encoder.encode(d));
      });
      term.onBinary((d) => send(Uint8Array.from(d, (c) => c.charCodeAt(0))));
      term.onResize(sendResize);
      term.textarea?.addEventListener("focus", () => callbacks.current.onFocus());

      safeFit();
      if (focusedRef.current) term.focus();
      resizeObserver.observe(container);
      void document.fonts?.ready.then(safeFit);
      connect(false);
    })();

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      resizeObserver.disconnect();
      ws?.close();
      ws = null;
      unregister();
      term?.dispose();
      termRef.current = null;
    };
  }, [paneId]);

  return <div ref={containerRef} className="h-full w-full overflow-hidden" />;
});
