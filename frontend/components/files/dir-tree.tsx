"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Folder, FolderOpen, House, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { filesApi, queryKeys } from "@/lib/api";
import { cn } from "@/lib/utils";
import { isDirLike } from "./file-icon";

/** `root` and every directory between it and `path` (inclusive). */
function ancestors(root: string, path: string): string[] {
  if (path !== root && !path.startsWith(root + "/")) return [root];
  const rest = path.slice(root.length).split("/").filter(Boolean);
  return [root, ...rest.map((_, i) => `${root}/${rest.slice(0, i + 1).join("/")}`)];
}

/** Lazily loaded directory tree rooted at the user's home; listings share the react-query cache with the file table. */
export function DirTree({
  serverId,
  currentPath,
  home,
  showHidden,
  onNavigate,
}: {
  serverId: number;
  currentPath: string | null;
  home: string | null;
  showHidden: boolean;
  onNavigate: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!currentPath || !home) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      ancestors(home, currentPath).forEach((p) => next.add(p));
      return next;
    });
  }, [currentPath, home]);

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <div className="flex flex-col gap-0.5 text-[13px]" role="tree">
      {home ? (
        <TreeNode
          serverId={serverId}
          path={home}
          name="~"
          isRoot
          depth={0}
          expanded={expanded}
          currentPath={currentPath}
          showHidden={showHidden}
          onToggle={toggle}
          onNavigate={onNavigate}
        />
      ) : null}
    </div>
  );
}

function TreeNode({
  serverId,
  path,
  name,
  isRoot = false,
  depth,
  expanded,
  currentPath,
  showHidden,
  onToggle,
  onNavigate,
}: {
  serverId: number;
  path: string;
  name: string;
  isRoot?: boolean;
  depth: number;
  expanded: Set<string>;
  currentPath: string | null;
  showHidden: boolean;
  onToggle: (path: string) => void;
  onNavigate: (path: string) => void;
}) {
  const open = expanded.has(path);
  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.files(serverId, path),
    queryFn: () => filesApi.list(serverId, path),
    enabled: open,
    staleTime: 30_000,
    retry: false,
  });
  const children = (data?.entries ?? [])
    .filter((e) => isDirLike(e) && (showHidden || !e.name.startsWith(".")))
    .sort((a, b) => a.name.localeCompare(b.name));
  const active = currentPath === path;
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active) rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div role="treeitem" aria-expanded={open} aria-selected={active}>
      <div
        ref={rowRef}
        className={cn(
          "group flex h-8 items-center gap-1 rounded-lg pr-2 transition-colors",
          active ? "bg-primary-soft font-medium text-primary" : "hover:bg-tile",
        )}
        style={{ paddingLeft: 4 + depth * 14 }}
      >
        <button
          type="button"
          aria-label={open ? `Collapse ${name}` : `Expand ${name}`}
          onClick={() => onToggle(path)}
          className="grid size-5 shrink-0 place-items-center rounded text-subtle hover:text-fg"
        >
          {open && isLoading ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
          )}
        </button>
        <button type="button" onClick={() => onNavigate(path)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
          {isRoot ? (
            <House className="size-4 shrink-0 text-primary" strokeWidth={1.8} />
          ) : open ? (
            <FolderOpen className="size-4 shrink-0 fill-primary/15 text-primary" strokeWidth={1.7} />
          ) : (
            <Folder className="size-4 shrink-0 fill-primary/15 text-primary" strokeWidth={1.7} />
          )}
          <span className="truncate">{isRoot ? "Home" : name}</span>
        </button>
      </div>
      {open && isError ? <p className="py-1 text-[11.5px] text-subtle" style={{ paddingLeft: 30 + depth * 14 }}>No access</p> : null}
      {open
        ? children.map((c) => (
            <TreeNode
              key={c.path}
              serverId={serverId}
              path={c.path}
              name={c.name}
              depth={depth + 1}
              expanded={expanded}
              currentPath={currentPath}
              showHidden={showHidden}
              onToggle={onToggle}
              onNavigate={onNavigate}
            />
          ))
        : null}
    </div>
  );
}
