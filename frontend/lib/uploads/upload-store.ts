/**
 * Browser-side upload queue. Files stream to the backend as raw XHR bodies (so the browser never
 * reads them into memory), at most MAX_PARALLEL at a time. The File objects are kept for the
 * session so failed/canceled uploads can be retried (or retried with overwrite on conflict).
 */
"use client";

import { useSyncExternalStore } from "react";
import { filesApi } from "@/lib/api";

const MAX_PARALLEL = 3;

export type UploadStatus = "queued" | "uploading" | "done" | "error" | "canceled";

export interface UploadItem {
  id: string;
  serverId: number;
  dir: string;
  /** Relative name, may contain sub-directories for folder uploads. */
  name: string;
  file: File;
  loaded: number;
  total: number;
  status: UploadStatus;
  error: string | null;
  conflict: boolean;
  overwrite: boolean;
  speed: number;
}

let items: UploadItem[] = [];
const listeners = new Set<() => void>();
const xhrs = new Map<string, XMLHttpRequest>();
const completionHandlers = new Set<(item: UploadItem) => void>();
const EMPTY: UploadItem[] = [];

function emit(): void {
  items = [...items];
  listeners.forEach((l) => l());
}

function patch(id: string, p: Partial<UploadItem>): void {
  items = items.map((it) => (it.id === id ? { ...it, ...p } : it));
  listeners.forEach((l) => l());
}

function pump(): void {
  const running = items.filter((i) => i.status === "uploading").length;
  const next = items.filter((i) => i.status === "queued").slice(0, Math.max(0, MAX_PARALLEL - running));
  next.forEach(start);
}

function start(item: UploadItem): void {
  const xhr = new XMLHttpRequest();
  xhrs.set(item.id, xhr);
  patch(item.id, { status: "uploading", loaded: 0, error: null, conflict: false, speed: 0 });
  let lastT = performance.now();
  let lastLoaded = 0;

  xhr.open("POST", filesApi.uploadUrl(item.serverId, item.dir, item.name, item.overwrite));
  xhr.withCredentials = true;
  xhr.setRequestHeader("Content-Type", "application/octet-stream");
  xhr.upload.onprogress = (e) => {
    const now = performance.now();
    const dt = (now - lastT) / 1000;
    if (dt >= 0.5) {
      const speed = (e.loaded - lastLoaded) / dt;
      lastT = now;
      lastLoaded = e.loaded;
      patch(item.id, { loaded: e.loaded, speed });
    } else {
      patch(item.id, { loaded: e.loaded });
    }
  };
  const finish = (p: Partial<UploadItem>) => {
    xhrs.delete(item.id);
    patch(item.id, { speed: 0, ...p });
    const done = items.find((i) => i.id === item.id);
    if (done) completionHandlers.forEach((h) => h(done));
    pump();
  };
  xhr.onload = () => {
    if (xhr.status >= 200 && xhr.status < 300) return finish({ status: "done", loaded: item.total });
    let message = `HTTP ${xhr.status}`;
    try {
      message = (JSON.parse(xhr.responseText) as { detail?: string }).detail ?? message;
    } catch {
      /* non-JSON */
    }
    finish({ status: xhr.status === 499 ? "canceled" : "error", error: message, conflict: xhr.status === 409 });
  };
  xhr.onerror = () => finish({ status: "error", error: "Network error" });
  xhr.onabort = () => finish({ status: "canceled", error: null });
  xhr.send(item.file);
}

export const uploads = {
  enqueue(serverId: number, dir: string, files: { file: File; name: string }[]): void {
    for (const { file, name } of files) {
      items.push({
        id: Math.random().toString(36).slice(2),
        serverId,
        dir,
        name,
        file,
        loaded: 0,
        total: file.size,
        status: "queued",
        error: null,
        conflict: false,
        overwrite: false,
        speed: 0,
      });
    }
    emit();
    pump();
  },
  cancel(id: string): void {
    const xhr = xhrs.get(id);
    if (xhr) xhr.abort();
    else patch(id, { status: "canceled" });
    pump();
  },
  retry(id: string, overwrite = false): void {
    patch(id, { status: "queued", error: null, conflict: false, overwrite, loaded: 0 });
    pump();
  },
  clearFinished(): void {
    items = items.filter((i) => i.status === "queued" || i.status === "uploading");
    emit();
  },
  onComplete(handler: (item: UploadItem) => void): () => void {
    completionHandlers.add(handler);
    return () => completionHandlers.delete(handler);
  },
};

export function useUploads(): UploadItem[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => items,
    () => EMPTY,
  );
}

/** Expand a drop into files, walking dropped folders recursively (keeps relative paths). */
export async function filesFromDrop(dt: DataTransfer): Promise<{ file: File; name: string }[]> {
  const entries = [...dt.items]
    .map((it) => (typeof it.webkitGetAsEntry === "function" ? it.webkitGetAsEntry() : null))
    .filter((e): e is FileSystemEntry => e !== null);
  if (entries.length === 0) return [...dt.files].map((file) => ({ file, name: file.name }));

  const out: { file: File; name: string }[] = [];
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      out.push({ file, name: prefix + entry.name });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      // readEntries returns batches; keep reading until empty.
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (batch.length === 0) break;
        for (const child of batch) await walk(child, `${prefix}${entry.name}/`);
      }
    }
  };
  for (const entry of entries) await walk(entry, "");
  return out;
}
