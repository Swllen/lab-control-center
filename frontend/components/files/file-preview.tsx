"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { Binary, ChevronDown, ChevronUp, Copy, Download, FileText, ImageOff, TriangleAlert, WrapText, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, Kbd, Skeleton } from "@/components/ui/misc";
import { filesApi, queryKeys } from "@/lib/api";
import { formatBytes, formatDateTime } from "@/lib/format";
import type { FileEntry } from "@/lib/types";
import { copyToClipboard, cn } from "@/lib/utils";
import { FileIcon } from "./file-icon";
import posixPath from "./posix-path";
import {
  CodeView,
  CsvView,
  IMAGE_MAX_BYTES,
  IMAGE_RE,
  JsonView,
  JsonlView,
  MarkdownView,
  previewModeFor,
  type PreviewMode,
} from "./preview-renderers";

const WRAP_KEY = "lcc.files.preview-wrap";

type View = "rendered" | "source";

const RENDERED_LABEL: Partial<Record<PreviewMode, string>> = {
  json: "Formatted",
  jsonl: "Records",
  markdown: "Preview",
  csv: "Table",
};

/**
 * Slide-over preview of one file. Text-like files load their first 1 MiB through /preview;
 * images stream from /preview/raw. ↑/↓ step through the folder's files, Esc closes.
 */
export function FilePreviewPanel({
  serverId,
  entry,
  position,
  onClose,
  onStep,
  onDownload,
}: {
  serverId: number;
  entry: FileEntry | null;
  /** 0-based index of `entry` among the folder's previewable files. */
  position: { index: number; total: number } | null;
  onClose: () => void;
  onStep: (dir: 1 | -1) => void;
  onDownload: (entry: FileEntry) => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>("rendered");
  const [wrap, setWrap] = useState(false);

  useEffect(() => {
    try {
      setWrap(window.localStorage.getItem(WRAP_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);

  const toggleWrap = () =>
    setWrap((w) => {
      try {
        window.localStorage.setItem(WRAP_KEY, w ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !w;
    });

  const hasPrev = !!position && position.index > 0;
  const hasNext = !!position && position.index < position.total - 1;
  const step = (dir: 1 | -1) => {
    if (dir === -1 ? !hasPrev : !hasNext) return;
    onStep(dir);
    // Keep focus on the panel (not inside the body that is about to be replaced) so the next
    // arrow key still reaches us.
    contentRef.current?.focus();
  };

  const keydown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      step(e.key === "ArrowDown" ? 1 : -1);
      return;
    }
    // The panel itself holds focus, so forward paging keys to the scroll area.
    const el = scrollRef.current;
    if (!el || target !== contentRef.current) return;
    const page = el.clientHeight * 0.9;
    const scroll: Record<string, number> = { PageDown: page, PageUp: -page, " ": e.shiftKey ? -page : page };
    if (e.key in scroll) el.scrollBy({ top: scroll[e.key] });
    else if (e.key === "Home") el.scrollTo({ top: 0 });
    else if (e.key === "End") el.scrollTo({ top: el.scrollHeight });
    else if (e.key === "ArrowRight" || e.key === "ArrowLeft") el.scrollBy({ left: e.key === "ArrowRight" ? 80 : -80 });
    else return;
    e.preventDefault();
  };

  const mode = entry ? previewModeFor(entry.name) : "text";
  const renderedLabel = RENDERED_LABEL[mode];
  useEffect(() => setView("rendered"), [mode]);
  const showsCode = mode === "text" || (renderedLabel !== undefined && (view === "source" || mode === "json"));

  return (
    <DialogPrimitive.Root open={!!entry} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-slate-900/10 animate-fade-in dark:bg-black/30" />
        <DialogPrimitive.Content
          ref={contentRef}
          tabIndex={-1}
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            contentRef.current?.focus();
          }}
          onKeyDown={keydown}
          className="glass-strong fixed inset-y-3 right-3 z-50 flex w-[min(900px,calc(100vw-24px))] flex-col overflow-hidden rounded-[24px] outline-none animate-fade-in"
        >
          {entry ? (
            <>
              <div className="flex items-start gap-3 border-b border-line px-5 pb-3 pt-4">
                <div className="tile grid size-10 shrink-0 place-items-center rounded-xl">
                  <FileIcon entry={entry} className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <DialogPrimitive.Title className="truncate text-[16px] font-semibold tracking-[-0.01em]">{entry.name}</DialogPrimitive.Title>
                  <p className="truncate font-mono text-[11.5px] text-subtle" title={entry.path}>
                    {entry.path}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {position ? (
                    <span className="tabular mr-1 hidden text-[12px] text-subtle sm:inline">
                      {position.index + 1} / {position.total}
                    </span>
                  ) : null}
                  <Button variant="ghost" size="icon-sm" aria-label="Previous file" title="Previous file (↑)" disabled={!hasPrev} onClick={() => step(-1)}>
                    <ChevronUp />
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label="Next file" title="Next file (↓)" disabled={!hasNext} onClick={() => step(1)}>
                    <ChevronDown />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Copy path"
                    title="Copy path"
                    onClick={() => void copyToClipboard(entry.path).then((ok) => toast(ok ? "Path copied" : entry.path))}
                  >
                    <Copy />
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => onDownload(entry)}>
                    <Download /> Download
                  </Button>
                  <DialogPrimitive.Close asChild>
                    <Button variant="ghost" size="icon-sm" aria-label="Close preview" title="Close (Esc)">
                      <X />
                    </Button>
                  </DialogPrimitive.Close>
                </div>
              </div>

              <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-5 py-1.5 text-[12px] text-muted">
                <span className="tabular">
                  {formatBytes(entry.size)} · Modified {formatDateTime(entry.mtime)}
                </span>
                <div className="ml-auto flex items-center gap-1.5">
                  {renderedLabel ? (
                    <div className="flex rounded-lg bg-track p-0.5" role="tablist" aria-label="View">
                      {(["rendered", "source"] as const).map((v) => (
                        <button
                          key={v}
                          type="button"
                          role="tab"
                          aria-selected={view === v}
                          onClick={() => setView(v)}
                          className={cn(
                            "rounded-md px-2.5 py-1 font-medium transition-colors",
                            view === v ? "bg-tile-hover text-fg shadow-tile" : "text-muted hover:text-fg",
                          )}
                        >
                          {v === "rendered" ? renderedLabel : "Source"}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {showsCode ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-pressed={wrap}
                      title="Wrap long lines"
                      onClick={toggleWrap}
                      className={cn(wrap && "bg-primary-soft text-primary hover:bg-primary-soft hover:text-primary")}
                    >
                      <WrapText /> Wrap
                    </Button>
                  ) : null}
                </div>
              </div>

              <PreviewBody
                key={entry.path}
                serverId={serverId}
                entry={entry}
                mode={mode}
                view={renderedLabel ? view : "rendered"}
                wrap={wrap}
                scrollRef={scrollRef}
                onDownload={onDownload}
              />

              <div className="flex items-center gap-3 border-t border-line px-5 py-2 text-[11.5px] text-subtle">
                <span className="flex items-center gap-1.5">
                  <Kbd>↑</Kbd>
                  <Kbd>↓</Kbd> previous / next file
                </span>
                <span className="flex items-center gap-1.5">
                  <Kbd>Esc</Kbd> close
                </span>
              </div>
            </>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function PreviewBody({
  serverId,
  entry,
  mode,
  view,
  wrap,
  scrollRef,
  onDownload,
}: {
  serverId: number;
  entry: FileEntry;
  mode: PreviewMode;
  view: View;
  wrap: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  onDownload: (entry: FileEntry) => void;
}) {
  if (mode === "image") return <ImagePreview serverId={serverId} entry={entry} scrollRef={scrollRef} onDownload={onDownload} />;
  return <TextPreview serverId={serverId} entry={entry} mode={mode} view={view} wrap={wrap} scrollRef={scrollRef} onDownload={onDownload} />;
}

function DownloadAction({ entry, onDownload }: { entry: FileEntry; onDownload: (entry: FileEntry) => void }) {
  return (
    <Button variant="primary" onClick={() => onDownload(entry)}>
      <Download /> Download {formatBytes(entry.size)}
    </Button>
  );
}

function TextPreview({
  serverId,
  entry,
  mode,
  view,
  wrap,
  scrollRef,
  onDownload,
}: {
  serverId: number;
  entry: FileEntry;
  mode: PreviewMode;
  view: View;
  wrap: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  onDownload: (entry: FileEntry) => void;
}) {
  const query = useQuery({
    queryKey: queryKeys.filePreview(serverId, entry.path),
    queryFn: () => filesApi.preview(serverId, entry.path),
    retry: false,
    staleTime: 15_000,
  });

  // Relative image links in Markdown resolve against the file's folder on the same server.
  const resolveImage = useCallback(
    (src: string): string | null => {
      if (/^https:\/\//i.test(src) || /^data:image\/(png|jpe?g|gif|webp);/i.test(src)) return src;
      if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return null;
      const clean = decodeURI(src.split(/[?#]/)[0] ?? "");
      if (!IMAGE_RE.test(clean)) return null;
      const target = clean.startsWith("/") ? clean : posixPath.join(posixPath.dirname(entry.path), clean);
      return filesApi.previewRawUrl(serverId, target);
    },
    [serverId, entry.path],
  );

  if (query.isLoading) {
    return (
      <div className="min-h-0 flex-1 space-y-2.5 px-5 py-4">
        {Array.from({ length: 14 }, (_, i) => (
          <Skeleton key={i} className="h-3.5" />
        ))}
      </div>
    );
  }
  if (query.error || !query.data) {
    return (
      <EmptyState
        className="flex-1"
        icon={<TriangleAlert />}
        title="Couldn't preview this file"
        description={query.error instanceof Error ? query.error.message : "Unknown error"}
        action={<DownloadAction entry={entry} onDownload={onDownload} />}
      />
    );
  }

  const p = query.data;
  if (p.kind === "binary" || p.content === null) {
    return (
      <EmptyState
        className="flex-1"
        icon={<Binary />}
        title="Binary file"
        description={`${formatBytes(p.size)} — this file doesn't look like text, so there's nothing to show here.`}
        action={<DownloadAction entry={entry} onDownload={onDownload} />}
      />
    );
  }
  if (p.content === "") {
    return <EmptyState className="flex-1" icon={<FileText />} title="Empty file" description="This file has no content." />;
  }

  const text = p.content;
  let body;
  if (view === "source" || mode === "text") body = <CodeView text={text} wrap={wrap} />;
  else if (mode === "json") body = <JsonView text={text} truncated={p.truncated} wrap={wrap} />;
  else if (mode === "jsonl") body = <JsonlView text={text} truncated={p.truncated} />;
  else if (mode === "markdown") body = <MarkdownView text={text} resolveImage={resolveImage} />;
  else body = <CsvView text={text} truncated={p.truncated} tsv={/\.tsv$/i.test(entry.name)} />;

  return (
    <>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        {body}
      </div>
      {p.truncated || p.encoding !== "utf-8" ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line bg-warning-soft px-5 py-2 text-[12.5px] text-warning">
          {p.truncated ? (
            <>
              <span className="tabular">
                Showing the first {formatBytes(p.bytes_read)} of {formatBytes(p.size)}
              </span>
              <button type="button" onClick={() => onDownload(entry)} className="font-medium underline-offset-2 hover:underline">
                Download full file
              </button>
            </>
          ) : null}
          {p.encoding !== "utf-8" ? <span>Some bytes aren't valid UTF-8 and are shown as �</span> : null}
        </div>
      ) : null}
    </>
  );
}

function ImagePreview({
  serverId,
  entry,
  scrollRef,
  onDownload,
}: {
  serverId: number;
  entry: FileEntry;
  scrollRef: RefObject<HTMLDivElement | null>;
  onDownload: (entry: FileEntry) => void;
}) {
  const [failed, setFailed] = useState(false);
  const [actualSize, setActualSize] = useState(false);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  if (entry.size > IMAGE_MAX_BYTES || failed) {
    return (
      <EmptyState
        className="flex-1"
        icon={<ImageOff />}
        title={failed ? "Couldn't load this image" : "Image too large to preview"}
        description={failed ? "The file may be corrupt or in a format the browser can't display." : `Images over ${formatBytes(IMAGE_MAX_BYTES)} are not previewed.`}
        action={<DownloadAction entry={entry} onDownload={onDownload} />}
      />
    );
  }
  return (
    <>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto p-5">
        <div className={cn("flex min-h-full", actualSize ? "items-start justify-start" : "items-center justify-center")}>
          {/* Same-site backend URL: the session cookie is sent like for downloads. */}
          <img
            src={filesApi.previewRawUrl(serverId, entry.path)}
            alt={entry.name}
            onError={() => setFailed(true)}
            onLoad={(e) => setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            onClick={() => setActualSize((v) => !v)}
            className={cn(
              "tile rounded-xl",
              actualSize ? "max-w-none cursor-zoom-out" : "max-h-[calc(100vh-260px)] max-w-full cursor-zoom-in object-contain",
            )}
          />
        </div>
      </div>
      {dims ? (
        <div className="tabular border-t border-line px-5 py-2 text-[12px] text-muted">
          {dims.w} × {dims.h} px · click the image to {actualSize ? "fit it to the panel" : "view at actual size"}
        </div>
      ) : null}
    </>
  );
}
