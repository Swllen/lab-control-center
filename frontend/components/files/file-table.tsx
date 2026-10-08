"use client";

import { ArrowDown, ArrowUp, Copy, Download, EllipsisVertical, FolderInput, Pencil, Send, Trash2 } from "lucide-react";
import { useMemo, useRef, type KeyboardEvent, type MouseEvent } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/misc";
import { formatBytes, formatDateTime } from "@/lib/format";
import type { FileEntry } from "@/lib/types";
import { cn } from "@/lib/utils";
import { FileIcon, isDirLike } from "./file-icon";

export type SortKey = "name" | "size" | "mtime";
export interface SortState {
  key: SortKey;
  dir: 1 | -1;
}

export type RowAction = "open" | "download" | "rename" | "move" | "copy-to" | "copy-path" | "delete";

export function sortEntries(entries: FileEntry[], sort: SortState): FileEntry[] {
  return [...entries].sort((a, b) => {
    const dirA = isDirLike(a) ? 0 : 1;
    const dirB = isDirLike(b) ? 0 : 1;
    if (dirA !== dirB) return dirA - dirB;
    let cmp = 0;
    if (sort.key === "size") cmp = a.size - b.size;
    else if (sort.key === "mtime") cmp = (a.mtime ?? 0) - (b.mtime ?? 0);
    if (cmp === 0) cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
    return cmp * sort.dir;
  });
}

export function FileTable({
  entries,
  loading,
  selected,
  onSelect,
  sort,
  onSort,
  onAction,
  onKeyAction,
}: {
  entries: FileEntry[];
  loading: boolean;
  selected: Set<string>;
  onSelect: (next: Set<string>) => void;
  sort: SortState;
  onSort: (s: SortState) => void;
  onAction: (action: RowAction, entry: FileEntry) => void;
  onKeyAction: (key: "up" | "delete" | "rename" | "open" | "escape") => void;
}) {
  const anchor = useRef<string | null>(null);
  const index = useMemo(() => new Map(entries.map((e, i) => [e.path, i])), [entries]);

  const click = (e: MouseEvent, entry: FileEntry) => {
    if (e.shiftKey && anchor.current && index.has(anchor.current)) {
      const i = index.get(anchor.current)!;
      const j = index.get(entry.path)!;
      onSelect(new Set(entries.slice(Math.min(i, j), Math.max(i, j) + 1).map((x) => x.path)));
      return;
    }
    if (e.metaKey || e.ctrlKey) {
      const next = new Set(selected);
      if (next.has(entry.path)) next.delete(entry.path);
      else next.add(entry.path);
      onSelect(next);
    } else {
      onSelect(new Set([entry.path]));
    }
    anchor.current = entry.path;
  };

  const keydown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      onSelect(new Set(entries.map((x) => x.path)));
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const cur = anchor.current ? index.get(anchor.current) ?? -1 : -1;
      const next = entries[Math.min(Math.max(cur + (e.key === "ArrowDown" ? 1 : -1), 0), entries.length - 1)];
      if (next) {
        anchor.current = next.path;
        onSelect(new Set([next.path]));
        document.getElementById(`row-${next.path}`)?.scrollIntoView({ block: "nearest" });
      }
    } else if (e.key === "Backspace") onKeyAction("up");
    else if (e.key === "Delete") onKeyAction("delete");
    else if (e.key === "F2") onKeyAction("rename");
    else if (e.key === "Enter") onKeyAction("open");
    else if (e.key === "Escape") onKeyAction("escape");
  };

  const header = (key: SortKey, label: string, className?: string) => (
    <th className={className}>
      <button
        type="button"
        onClick={() => onSort({ key, dir: sort.key === key ? ((-sort.dir) as 1 | -1) : 1 })}
        className="inline-flex items-center gap-1 hover:text-fg"
      >
        {label}
        {sort.key === key ? sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : null}
      </button>
    </th>
  );

  return (
    <div className="min-h-0 flex-1 overflow-auto pb-16 outline-none" tabIndex={0} onKeyDown={keydown} aria-label="Files">
      <table className="w-full min-w-[640px] border-separate border-spacing-0 text-[13px]">
        <thead className="sticky top-0 z-10 bg-glass-strong backdrop-blur-xl">
          <tr className="text-left text-[12px] text-muted [&_th]:border-b [&_th]:border-line [&_th]:px-3 [&_th]:py-2 [&_th]:font-medium">
            {header("name", "Name", "pl-5")}
            {header("size", "Size", "w-24 text-right")}
            {header("mtime", "Modified", "w-40")}
            <th className="hidden w-28 xl:table-cell">Permissions</th>
            <th className="hidden w-32 xl:table-cell">Owner</th>
            <th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: 8 }, (_, i) => (
                <tr key={i}>
                  <td colSpan={6} className="px-4 py-1.5"><Skeleton className="h-6" /></td>
                </tr>
              ))
            : entries.map((entry) => {
                const isSel = selected.has(entry.path);
                return (
                  <tr
                    key={entry.path}
                    id={`row-${entry.path}`}
                    onClick={(e) => click(e, entry)}
                    onDoubleClick={() => onAction("open", entry)}
                    className={cn(
                      "group cursor-default select-none [&_td]:border-b [&_td]:border-line/60 [&_td]:px-3 [&_td]:py-[7px]",
                      isSel ? "bg-primary-soft" : "hover:bg-tile-hover/70",
                    )}
                    aria-selected={isSel}
                  >
                    <td className="max-w-0 pl-5">
                      <span className="flex min-w-0 items-center gap-2.5">
                        <FileIcon entry={entry} />
                        <span className={cn("truncate", isDirLike(entry) && "font-medium", entry.name.startsWith(".") && "text-muted")}>
                          {entry.name}
                        </span>
                        {entry.type === "symlink" ? (
                          <span className="truncate font-mono text-[11.5px] text-subtle">→ {entry.link_target ?? "?"}</span>
                        ) : null}
                      </span>
                    </td>
                    <td className="tabular text-right text-muted">{isDirLike(entry) ? "—" : formatBytes(entry.size)}</td>
                    <td className="tabular text-muted">{formatDateTime(entry.mtime)}</td>
                    <td className="hidden font-mono text-[12px] text-muted xl:table-cell">{entry.mode}</td>
                    <td className="hidden truncate text-muted xl:table-cell">
                      {entry.owner ?? "—"}
                      {entry.group && entry.group !== entry.owner ? <span className="text-subtle">:{entry.group}</span> : null}
                    </td>
                    <td className="pr-2 text-right">
                      <RowMenu entry={entry} onAction={onAction} />
                    </td>
                  </tr>
                );
              })}
        </tbody>
      </table>
    </div>
  );
}

function RowMenu({ entry, onAction }: { entry: FileEntry; onAction: (a: RowAction, e: FileEntry) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Actions for ${entry.name}`}
          onClick={(e) => e.stopPropagation()}
          className="grid size-7 place-items-center rounded-lg text-subtle opacity-0 transition hover:bg-tile hover:text-fg focus:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
        >
          <EllipsisVertical className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onSelect={() => onAction("download", entry)}>
          <Download /> {isDirLike(entry) ? "Download as .tar" : "Download"}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction("rename", entry)}><Pencil /> Rename</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction("move", entry)}><FolderInput /> Move to…</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction("copy-to", entry)}><Send /> Copy to server…</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction("copy-path", entry)}><Copy /> Copy absolute path</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem tone="danger" onSelect={() => onAction("delete", entry)}><Trash2 /> Delete…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
