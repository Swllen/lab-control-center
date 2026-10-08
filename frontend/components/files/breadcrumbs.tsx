"use client";

import { ChevronRight, House } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

/** Clickable path segments relative to the home folder ("~ / a / b"); click empty space to type a path. */
export function Breadcrumbs({ path, home, onNavigate }: { path: string; home: string; onNavigate: (p: string) => void }) {
  const [editing, setEditing] = useState(false);
  const parts = path === home ? [] : path.slice(home.length).split("/").filter(Boolean);
  const display = path === home ? "~" : `~${path.slice(home.length)}`;

  if (editing) {
    return (
      <form
        className="min-w-0 flex-1"
        onSubmit={(e) => {
          e.preventDefault();
          const value = new FormData(e.currentTarget).get("path");
          setEditing(false);
          if (typeof value === "string" && value.trim()) onNavigate(value.trim());
        }}
      >
        <input
          name="path"
          autoFocus
          defaultValue={display}
          spellCheck={false}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
          className="h-9 w-full rounded-xl border border-primary/40 bg-glass-strong px-3 font-mono text-[13px] outline-none ring-4 ring-primary/10"
        />
      </form>
    );
  }

  return (
    <div
      className="flex h-9 min-w-0 flex-1 cursor-text items-center gap-0.5 overflow-x-auto rounded-xl px-1.5 text-[13.5px] hover:bg-tile"
      onClick={(e) => e.target === e.currentTarget && setEditing(true)}
      title="Click empty space to type a path"
    >
      <button
        type="button"
        onClick={() => onNavigate(home)}
        className={cn(
          "flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-1.5 text-muted hover:bg-tile-hover hover:text-fg",
          path === home && "font-semibold text-primary",
        )}
        title={home}
      >
        <House className="size-4" />
        <span className="font-mono">~</span>
      </button>
      {parts.map((part, i) => {
        const target = `${home}/${parts.slice(0, i + 1).join("/")}`;
        const last = i === parts.length - 1;
        return (
          <span key={target} className="flex shrink-0 items-center gap-0.5">
            <ChevronRight className="size-3.5 text-subtle" />
            <button
              type="button"
              onClick={() => onNavigate(target)}
              className={cn(
                "max-w-48 truncate rounded-md px-1.5 py-0.5 hover:bg-tile-hover",
                last ? "font-semibold text-fg" : "text-muted hover:text-fg",
              )}
            >
              {part}
            </button>
          </span>
        );
      })}
    </div>
  );
}
