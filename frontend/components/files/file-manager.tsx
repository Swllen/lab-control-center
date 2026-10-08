"use client";

import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUp,
  Copy,
  Download,
  Eye,
  EyeOff,
  FolderInput,
  FolderPlus,
  FolderUp,
  Pencil,
  RefreshCw,
  Send,
  Trash2,
  TriangleAlert,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";
import { ServerPicker } from "@/components/hardware/server-picker";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/misc";
import { filesApi, queryKeys, transfersApi } from "@/lib/api";
import { triggerDownload } from "@/lib/download";
import { formatBytes } from "@/lib/format";
import type { FileEntry, Server } from "@/lib/types";
import { uploads, filesFromDrop } from "@/lib/uploads/upload-store";
import { copyToClipboard, cn } from "@/lib/utils";
import { Breadcrumbs } from "./breadcrumbs";
import { DirTree } from "./dir-tree";
import { CopyToServerDialog, DeleteDialog, PromptDialog } from "./file-dialogs";
import { isDirLike } from "./file-icon";
import { FileTable, sortEntries, type RowAction, type SortState } from "./file-table";
import posixPath from "./posix-path";

const HIDDEN_KEY = "lcc.files.show-hidden";

function readShowHidden(): boolean {
  try {
    return window.localStorage.getItem(HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

type Dialog =
  | { kind: "mkdir" }
  | { kind: "rename"; entry: FileEntry }
  | { kind: "move"; entries: FileEntry[] }
  | { kind: "delete"; entries: FileEntry[] }
  | { kind: "copy-to"; entries: FileEntry[] }
  | null;

export function FileManager({
  servers,
  serverId,
  path,
  onNavigate,
}: {
  servers: Server[];
  serverId: number;
  path: string;
  onNavigate: (serverId: number, path: string) => void;
}) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortState>({ key: "name", dir: 1 });
  const [showHidden, setShowHidden] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  useEffect(() => setShowHidden(readShowHidden()), []);
  useEffect(() => setSelected(new Set()), [serverId, path]);

  const listing = useQuery({
    queryKey: queryKeys.files(serverId, path),
    queryFn: () => filesApi.list(serverId, path),
    placeholderData: keepPreviousData,
    retry: false,
  });
  const current = listing.data?.path ?? null;
  const home = listing.data?.home ?? null;

  // Refresh the listing when uploads into this server finish.
  useEffect(
    () =>
      uploads.onComplete((item) => {
        if (item.status === "done" && item.serverId === serverId) {
          void qc.invalidateQueries({ queryKey: ["files", serverId] });
        }
      }),
    [qc, serverId],
  );

  const entries = useMemo(() => {
    const all = listing.data?.entries ?? [];
    return sortEntries(showHidden ? all : all.filter((e) => !e.name.startsWith(".")), sort);
  }, [listing.data, showHidden, sort]);

  // Browsing is scoped to the user's home folder: anything outside it redirects home, "up" stops
  // at home, and relative input is taken relative to home.
  const inHome = (p: string) => !!home && (p === home || p.startsWith(home + "/"));
  const canGoUp = !!current && !!home && current !== home && inHome(current);
  useEffect(() => {
    if (current && home && !inHome(current)) onNavigate(serverId, home);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, home, serverId]);

  const selectedEntries = entries.filter((e) => selected.has(e.path));
  const hiddenCount = showHidden ? 0 : (listing.data?.entries.length ?? 0) - entries.length;

  const refresh = () => qc.invalidateQueries({ queryKey: ["files", serverId] });
  const go = (p: string) => onNavigate(serverId, p.startsWith("/") || p.startsWith("~") ? p : `~/${p}`);
  const toggleHidden = () => {
    setShowHidden((v) => {
      try {
        window.localStorage.setItem(HIDDEN_KEY, v ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !v;
    });
  };

  const upload = (files: { file: File; name: string }[]) => {
    if (!current || files.length === 0) return;
    uploads.enqueue(serverId, current, files);
  };

  const download = (list: FileEntry[]) => {
    list.forEach((e, i) => setTimeout(() => triggerDownload(serverId, e.path), i * 400));
    if (list.length) toast(`Downloading ${list.length === 1 ? list[0]!.name : `${list.length} items`}`, { description: "Streaming from the server" });
  };

  const onAction = (action: RowAction, entry: FileEntry) => {
    const targets = selected.has(entry.path) && selected.size > 1 ? selectedEntries : [entry];
    switch (action) {
      case "open":
        if (isDirLike(entry)) go(entry.path);
        else download([entry]);
        break;
      case "download":
        download(targets);
        break;
      case "rename":
        setDialog({ kind: "rename", entry });
        break;
      case "move":
        setDialog({ kind: "move", entries: targets });
        break;
      case "copy-to":
        setDialog({ kind: "copy-to", entries: targets });
        break;
      case "copy-path":
        void copyToClipboard(entry.path).then((ok) => toast(ok ? "Path copied" : entry.path, { description: ok ? entry.path : undefined }));
        break;
      case "delete":
        setDialog({ kind: "delete", entries: targets });
        break;
    }
  };

  const onKeyAction = (key: "up" | "delete" | "rename" | "open" | "escape") => {
    const first = selectedEntries[0];
    if (key === "up" && canGoUp && listing.data?.parent) go(listing.data.parent);
    else if (key === "escape") setSelected(new Set());
    else if (key === "delete" && selectedEntries.length) setDialog({ kind: "delete", entries: selectedEntries });
    else if (key === "rename" && first) setDialog({ kind: "rename", entry: first });
    else if (key === "open" && first) onAction("open", first);
  };

  // ------------------------------------------------------------ drag & drop
  const onDragEnter = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };
  const onDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };
  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    upload(await filesFromDrop(e.dataTransfer));
  };

  const error = listing.error instanceof Error ? listing.error.message : null;
  const totalSize = entries.reduce((s, e) => s + (isDirLike(e) ? 0 : e.size), 0);

  return (
    <div className="grid h-[calc(100vh-150px)] min-h-[520px] grid-cols-1 gap-5 lg:grid-cols-[270px_1fr] 3xl:grid-cols-[320px_1fr]">
      {/* Left: servers + tree */}
      <GlassCard className="hidden min-h-0 flex-col p-3 lg:flex">
        <ServerPicker servers={servers} value={serverId} onChange={(id) => onNavigate(id, "~")} />
        <div className="mt-3 min-h-0 flex-1 overflow-auto pr-1">
          <DirTree serverId={serverId} currentPath={current} home={home} showHidden={showHidden} onNavigate={go} />
        </div>
      </GlassCard>

      {/* Right: toolbar + table */}
      <GlassCard
        className="relative flex min-h-0 min-w-0 flex-col overflow-hidden"
        onDragEnter={onDragEnter}
        onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Parent folder"
            title="Parent folder (Backspace)"
            disabled={!canGoUp}
            onClick={() => canGoUp && listing.data?.parent && go(listing.data.parent)}
          >
            <ArrowUp />
          </Button>
          {current && home ? <Breadcrumbs path={current} home={home} onNavigate={go} /> : <div className="flex-1" />}
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon-sm" title={showHidden ? "Hide dotfiles" : "Show dotfiles"} aria-label="Toggle hidden files" onClick={toggleHidden}>
              {showHidden ? <Eye /> : <EyeOff />}
            </Button>
            <Button variant="ghost" size="icon-sm" title="Refresh" aria-label="Refresh" onClick={() => void refresh()}>
              <RefreshCw className={cn(listing.isFetching && "animate-spin")} />
            </Button>
            <Button variant="ghost" size="icon-sm" title="New folder" aria-label="New folder" disabled={!current} onClick={() => setDialog({ kind: "mkdir" })}>
              <FolderPlus />
            </Button>
            <Button variant="ghost" size="icon-sm" title="Upload folder" aria-label="Upload folder" disabled={!current} onClick={() => folderInput.current?.click()}>
              <FolderUp />
            </Button>
            <Button variant="primary" size="sm" disabled={!current} onClick={() => fileInput.current?.click()}>
              <Upload /> Upload
            </Button>
          </div>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              upload([...(e.target.files ?? [])].map((file) => ({ file, name: file.name })));
              e.target.value = "";
            }}
          />
          <input
            ref={folderInput}
            type="file"
            hidden
            // @ts-expect-error non-standard but universally supported directory picker
            webkitdirectory=""
            onChange={(e) => {
              upload([...(e.target.files ?? [])].map((file) => ({ file, name: file.webkitRelativePath || file.name })));
              e.target.value = "";
            }}
          />
        </div>

        {error ? (
          <EmptyState
            icon={<TriangleAlert />}
            title="Cannot open this folder"
            description={error}
            action={home ? <Button onClick={() => go(home)}>Go home</Button> : <Button onClick={() => go("~")}>Go home</Button>}
          />
        ) : !listing.isLoading && entries.length === 0 ? (
          <EmptyState
            icon={<FolderPlus />}
            title="This folder is empty"
            description="Drop files here or use Upload. Folders can be dropped too."
            className="flex-1"
          />
        ) : (
          <FileTable
            entries={entries}
            loading={listing.isLoading}
            selected={selected}
            onSelect={setSelected}
            sort={sort}
            onSort={setSort}
            onAction={onAction}
            onKeyAction={onKeyAction}
          />
        )}

        <div className="tabular flex items-center justify-between border-t border-line px-4 py-2 text-[11.5px] text-muted">
          <span>
            {entries.length} item{entries.length === 1 ? "" : "s"} · {formatBytes(totalSize)}
            {hiddenCount > 0 ? ` · ${hiddenCount} hidden` : ""}
            {listing.data?.truncated ? " · listing truncated at 20,000 entries" : ""}
          </span>
          <span className="hidden sm:inline">Drop files or folders to upload · Backspace: up · F2: rename · Del: delete</span>
        </div>

        {selectedEntries.length > 0 ? (
          <div
            role="toolbar"
            aria-label="Selection actions"
            className="glass-strong absolute bottom-12 left-1/2 z-20 flex -translate-x-1/2 items-center gap-0.5 whitespace-nowrap rounded-2xl p-1.5 text-[12.5px] animate-fade-in"
          >
            <span className="tabular px-2.5 font-medium">{selectedEntries.length} selected</span>
            <span className="mx-1 h-5 w-px bg-line" />
            <Button size="sm" variant="ghost" onClick={() => download(selectedEntries)}><Download /> Download</Button>
            {selectedEntries.length === 1 ? (
              <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "rename", entry: selectedEntries[0]! })}><Pencil /> Rename</Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "move", entries: selectedEntries })}><FolderInput /> Move</Button>
            <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "copy-to", entries: selectedEntries })}><Send /> Copy to server</Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void copyToClipboard(selectedEntries.map((e) => e.path).join("\n")).then(() => toast("Path copied"))}
            >
              <Copy /> Copy path
            </Button>
            <Button size="sm" variant="ghost" className="text-danger hover:bg-danger-soft hover:text-danger" onClick={() => setDialog({ kind: "delete", entries: selectedEntries })}>
              <Trash2 /> Delete
            </Button>
            <span className="mx-1 h-5 w-px bg-line" />
            <Button size="icon-sm" variant="ghost" aria-label="Clear selection" title="Clear selection (Esc)" onClick={() => setSelected(new Set())}>
              <X />
            </Button>
          </div>
        ) : null}

        {dragging ? (
          <div className="pointer-events-none absolute inset-2 z-20 grid place-items-center rounded-[18px] border-2 border-dashed border-primary bg-primary-soft/80 backdrop-blur-sm animate-fade-in">
            <div className="text-center">
              <Upload className="mx-auto mb-2 size-8 text-primary" />
              <p className="text-[15px] font-semibold text-primary">Drop to upload</p>
              <p className="mt-1 font-mono text-[12px] text-muted">{current}</p>
            </div>
          </div>
        ) : null}
      </GlassCard>

      {/* Dialogs */}
      <PromptDialog
        open={dialog?.kind === "mkdir"}
        onOpenChange={(o) => !o && setDialog(null)}
        icon={<FolderPlus />}
        title="New folder"
        label="Folder name"
        initial=""
        confirmLabel="Create"
        onSubmit={async (name) => {
          await filesApi.mkdir(serverId, posixPath.join(current ?? "~", name));
          await refresh();
        }}
      />
      <PromptDialog
        open={dialog?.kind === "rename"}
        onOpenChange={(o) => !o && setDialog(null)}
        icon={<Pencil />}
        title="Rename"
        label="New name"
        initial={dialog?.kind === "rename" ? dialog.entry.name : ""}
        confirmLabel="Rename"
        selectStem
        onSubmit={async (name) => {
          if (dialog?.kind !== "rename") return;
          if (name.includes("/")) throw new Error("Use Move to change folders");
          await filesApi.rename(serverId, dialog.entry.path, posixPath.join(posixPath.dirname(dialog.entry.path), name));
          await refresh();
        }}
      />
      <PromptDialog
        open={dialog?.kind === "move"}
        onOpenChange={(o) => !o && setDialog(null)}
        icon={<FolderInput />}
        title={dialog?.kind === "move" && dialog.entries.length > 1 ? `Move ${dialog.entries.length} items` : "Move"}
        description="Items keep their names and are moved into this folder on the same server."
        label="Destination folder"
        initial={current ?? "~"}
        confirmLabel="Move"
        mono
        onSubmit={async (dest) => {
          if (dialog?.kind !== "move") return;
          for (const e of dialog.entries) await filesApi.rename(serverId, e.path, dest);
          await refresh();
          toast.success(`Moved ${dialog.entries.length} item${dialog.entries.length > 1 ? "s" : ""}`);
        }}
      />
      <DeleteDialog
        entries={dialog?.kind === "delete" ? dialog.entries : []}
        onOpenChange={(o) => !o && setDialog(null)}
        onConfirm={async () => {
          if (dialog?.kind !== "delete") return;
          try {
            await filesApi.remove(serverId, dialog.entries.map((e) => e.path));
            toast.success(`Deleted ${dialog.entries.length} item${dialog.entries.length > 1 ? "s" : ""}`);
            setDialog(null);
            setSelected(new Set());
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Delete failed");
          } finally {
            await refresh();
          }
        }}
      />
      <CopyToServerDialog
        entries={dialog?.kind === "copy-to" ? dialog.entries : []}
        servers={servers}
        sourceServerId={serverId}
        onOpenChange={(o) => !o && setDialog(null)}
        onConfirm={async (destServerId, destDir) => {
          if (dialog?.kind !== "copy-to") return;
          for (const e of dialog.entries) {
            await transfersApi.copy({ source_server_id: serverId, source_path: e.path, dest_server_id: destServerId, dest_dir: destDir });
          }
          void qc.invalidateQueries({ queryKey: ["transfers"] });
          toast.success("Copy started", { description: "Track progress on the Transfers page" });
        }}
      />
    </div>
  );
}
