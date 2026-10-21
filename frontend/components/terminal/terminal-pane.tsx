"use client";

import { Copy, History, Layers, Maximize2, Minimize2, RotateCw, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { terminalsApi } from "@/lib/api";
import type { PaneState } from "@/lib/terminal/workspace-store";
import { workspace } from "@/lib/terminal/workspace-store";
import { cn } from "@/lib/utils";
import { closePaneSession, hasTmux } from "./tmux";
import { XtermView, type ConnState, type XtermHandle } from "./xterm-view";

const STATE_STYLE: Record<ConnState, { dot: string; label: string }> = {
  connecting: { dot: "bg-amber-400 animate-pulse", label: "Connecting…" },
  connected: { dot: "bg-emerald-400", label: "Connected" },
  disconnected: { dot: "bg-amber-400", label: "Disconnected" },
  exited: { dot: "bg-slate-500", label: "Exited" },
  error: { dot: "bg-rose-400", label: "Error" },
};

function TerminalHistory({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const scrollRef = useRef<HTMLPreElement>(null);
  const [result, setResult] = useState<{ text?: string; error?: string }>({});
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setResult({});
    void terminalsApi.history(sessionId).then(
      ({ text }) => { if (!cancelled) setResult({ text }); },
      (error: unknown) => { if (!cancelled) setResult({ error: error instanceof Error ? error.message : "Could not load history" }); },
    );
    return () => { cancelled = true; };
  }, [sessionId, version]);
  useEffect(() => {
    if (result.text !== undefined && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [result.text]);
  return (
    <aside className="flex min-h-0 w-1/2 min-w-0 flex-col border-l border-white/10" aria-label="Tmux history" onMouseDown={(e) => e.stopPropagation()}>
      <div className="flex shrink-0 items-center gap-1 px-2 py-1 text-xs text-slate-300">
        <span className="mr-auto">History · last 10,000 lines</span>
        <HeaderButton label="Refresh history" onClick={() => setVersion((v) => v + 1)}><RotateCw /></HeaderButton>
        <HeaderButton label="Close history" onClick={onClose}><X /></HeaderButton>
      </div>
      <pre ref={scrollRef} tabIndex={0} className="min-h-0 flex-1 overflow-x-auto overflow-y-scroll whitespace-pre p-3 font-mono text-xs leading-relaxed text-slate-300 [scrollbar-color:#64748b_#141d2e] [scrollbar-width:auto]" aria-label="Scrollable terminal history">
        {result.error ?? result.text ?? "Loading history…"}
      </pre>
      <button type="button" className="shrink-0 border-t border-white/10 py-2 text-xs text-slate-300 hover:bg-white/10" onClick={() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; }}>Jump to bottom</button>
    </aside>
  );
}

function HeaderButton({ label, onClick, children, danger }: { label: string; onClick: () => void; children: ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "grid size-7 place-items-center rounded-lg text-slate-400 transition hover:bg-white/10 hover:text-slate-100 [&_svg]:size-3.5",
        danger && "hover:bg-rose-500/20 hover:text-rose-300",
      )}
    >
      {children}
    </button>
  );
}

export function TerminalPane({
  pane,
  serverName,
  tabId,
  maximized,
  focused,
  onFocus,
}: {
  pane: PaneState;
  serverName: string;
  tabId: string;
  maximized: boolean;
  focused: boolean;
  onFocus: () => void;
}) {
  const xterm = useRef<XtermHandle>(null);
  const [state, setState] = useState<{ s: ConnState; detail?: string }>({ s: "connecting" });
  const [editing, setEditing] = useState(false);
  const [askTmux, setAskTmux] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const style = STATE_STYLE[state.s];

  const close = (killTmux = false) => {
    setAskTmux(false);
    void closePaneSession(pane, killTmux).catch(() => undefined);
    workspace.closePane(pane.id);
  };

  const rename = (name: string) => {
    const trimmed = name.trim();
    setEditing(false);
    if (!trimmed || trimmed === pane.name) return;
    workspace.renamePane(pane.id, trimmed);
    if (pane.sessionId) void terminalsApi.rename(pane.sessionId, trimmed).catch(() => undefined);
  };

  return (
    <section
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl bg-[#0f1624] shadow-card ring-1 transition-[box-shadow]",
        focused ? "ring-primary/70 shadow-[0_0_0_3px_rgb(47_107_255/0.18)]" : "ring-white/[0.06]",
      )}
      onMouseDown={() => {
        onFocus();
        xterm.current?.focus();
      }}
      aria-label={`${serverName} / ${pane.name}`}
    >
      <header className="flex h-10 shrink-0 items-center gap-2.5 border-b border-white/[0.06] bg-[#141d2e] pl-3.5 pr-1.5 text-[12.5px]">
        <span className={cn("size-2 shrink-0 rounded-full", style.dot)} />
        <span className="shrink-0 font-semibold text-slate-100">{serverName}</span>
        {pane.account ? (
          <span
            className="shrink-0 rounded-md bg-amber-400/15 px-1.5 py-0.5 font-mono text-[11px] font-medium text-amber-300"
            title={`Logged in via ~/.ssh/config Host ${pane.account}`}
          >
            {pane.username ?? pane.account}
          </span>
        ) : null}
        {pane.tmux ? (
          <span
            className="shrink-0 rounded-md bg-emerald-400/15 px-1.5 py-0.5 font-mono text-[11px] font-medium text-emerald-300"
            title={pane.tmuxSession ? `tmux session ${pane.tmuxSession}` : "tmux"}
          >
            tmux
          </span>
        ) : null}
        <span className="text-slate-600">/</span>
        {editing ? (
          <input
            autoFocus
            defaultValue={pane.name}
            onBlur={(e) => rename(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") rename(e.currentTarget.value);
              if (e.key === "Escape") setEditing(false);
            }}
            className="h-6 w-32 rounded-md bg-white/10 px-1.5 font-mono text-slate-100 outline-none ring-1 ring-primary/60"
          />
        ) : (
          <button
            type="button"
            onDoubleClick={() => setEditing(true)}
            title="Double-click to rename"
            className="min-w-0 truncate font-mono text-slate-300 hover:text-slate-100"
          >
            {pane.name}
          </button>
        )}
        <span className="ml-1 hidden truncate text-[11.5px] text-slate-500 sm:inline">
          {style.label}
          {state.detail ? ` · ${state.detail}` : ""}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {pane.tmux && pane.sessionId ? (
            <HeaderButton label="Scroll tmux history" onClick={() => setHistoryOpen((open) => !open)}><History /></HeaderButton>
          ) : null}
          <HeaderButton label="Reconnect" onClick={() => xterm.current?.reconnect()}><RotateCw /></HeaderButton>
          <HeaderButton label="Duplicate" onClick={() => workspace.duplicatePane(pane.id)}><Copy /></HeaderButton>
          <HeaderButton label={maximized ? "Restore" : "Maximize"} onClick={() => workspace.toggleMaximize(tabId, pane.id)}>
            {maximized ? <Minimize2 /> : <Maximize2 />}
          </HeaderButton>
          <HeaderButton label="Close" onClick={() => (hasTmux(pane) ? setAskTmux(true) : close())} danger><X /></HeaderButton>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
      <div className="min-h-0 min-w-0 flex-1 py-1.5 pl-2.5 pr-1">
        <XtermView ref={xterm} paneId={pane.id} focused={focused} onFocus={onFocus} onState={(s, detail) => setState({ s, detail })} />
      </div>
      {historyOpen && pane.sessionId ? <TerminalHistory sessionId={pane.sessionId} onClose={() => setHistoryOpen(false)} /> : null}
      </div>

      <Dialog open={askTmux} onOpenChange={setAskTmux}>
        <DialogContent className="max-w-md" onMouseDown={(e) => e.stopPropagation()}>
          <DialogHeader
            icon={<Layers />}
            title={`Close “${pane.name}”?`}
            description={
              <>
                This terminal runs in tmux session <span className="font-mono text-fg">{pane.tmuxSession ?? "(starting)"}</span>. Keep it
                running on {serverName} to reattach later from New terminal → Reattach tmux session, or kill it and everything running in it.
              </>
            }
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAskTmux(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => close(true)}>Kill session</Button>
            <Button variant="primary" onClick={() => close(false)}>Keep running</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
