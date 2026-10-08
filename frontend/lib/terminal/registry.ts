/**
 * Live xterm instances by pane id, so other UI (the AI assistant) can read a terminal's recent
 * output or type into it without reaching into component internals.
 */
"use client";

export interface TerminalHandle {
  /** Last `lines` lines of the visible buffer (scrollback included), trailing blank lines removed. */
  recentOutput: (lines: number) => string;
  /** Put text on the shell's input line. Uses bracketed paste, so it is not executed. */
  insert: (text: string) => void;
  focus: () => void;
}

const handles = new Map<string, TerminalHandle>();

export function registerTerminal(paneId: string, handle: TerminalHandle): () => void {
  handles.set(paneId, handle);
  return () => {
    if (handles.get(paneId) === handle) handles.delete(paneId);
  };
}

export function getTerminal(paneId: string | null | undefined): TerminalHandle | undefined {
  return paneId ? handles.get(paneId) : undefined;
}
