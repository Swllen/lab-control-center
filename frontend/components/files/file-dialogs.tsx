"use client";

import { Send, Trash2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import type { FileEntry, Server } from "@/lib/types";
import { cn } from "@/lib/utils";
import { isDirLike } from "./file-icon";

/** Single-input dialog used for new folder / rename / move. */
export function PromptDialog({
  open,
  onOpenChange,
  icon,
  title,
  description,
  label,
  initial,
  confirmLabel,
  mono,
  selectStem,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  label: string;
  initial: string;
  confirmLabel: string;
  mono?: boolean;
  /** Pre-select the file name without its extension (rename). */
  selectStem?: boolean;
  onSubmit: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setValue(initial);
      setError(null);
      setPending(false);
    }
  }, [open, initial]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader icon={icon} title={title} description={description} />
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!value.trim()) return;
            setPending(true);
            setError(null);
            try {
              await onSubmit(value.trim());
              onOpenChange(false);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Failed");
            } finally {
              setPending(false);
            }
          }}
        >
          <Field label={label} htmlFor="prompt-input" error={error}>
            <Input
              id="prompt-input"
              autoFocus
              spellCheck={false}
              value={value}
              aria-invalid={!!error}
              onChange={(e) => setValue(e.target.value)}
              onFocus={(e) => {
                if (!selectStem) return e.target.select();
                const dot = e.target.value.lastIndexOf(".");
                e.target.setSelectionRange(0, dot > 0 ? dot : e.target.value.length);
              }}
              className={cn(mono && "font-mono")}
            />
          </Field>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={pending}>{confirmLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteDialog({
  entries,
  onOpenChange,
  onConfirm,
}: {
  entries: FileEntry[];
  onOpenChange: (o: boolean) => void;
  onConfirm: () => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const dirs = entries.filter((e) => e.type === "dir").length;
  return (
    <Dialog open={entries.length > 0} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader
          tone="danger"
          icon={<Trash2 />}
          title={entries.length === 1 ? `Delete “${entries[0]!.name}”?` : `Delete ${entries.length} items?`}
          description={
            dirs
              ? "Folders are deleted recursively with everything inside. This cannot be undone."
              : "This cannot be undone."
          }
        />
        <ul className="max-h-48 overflow-auto rounded-xl bg-track px-3 py-2 font-mono text-[12px] text-muted">
          {entries.slice(0, 50).map((e) => (
            <li key={e.path} className="truncate">{e.path}{isDirLike(e) ? "/" : ""}</li>
          ))}
          {entries.length > 50 ? <li>… and {entries.length - 50} more</li> : null}
        </ul>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="danger-solid"
            loading={pending}
            onClick={async () => {
              setPending(true);
              try {
                await onConfirm();
              } finally {
                setPending(false);
              }
            }}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CopyToServerDialog({
  entries,
  servers,
  sourceServerId,
  onOpenChange,
  onConfirm,
}: {
  entries: FileEntry[];
  servers: Server[];
  sourceServerId: number;
  onOpenChange: (o: boolean) => void;
  onConfirm: (destServerId: number, destDir: string) => Promise<void>;
}) {
  const targets = servers.filter((s) => s.transport === "ssh");
  const [dest, setDest] = useState<number | null>(null);
  const [dir, setDir] = useState("~");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = entries.length > 0;

  useEffect(() => {
    if (open) {
      setDest(targets.find((s) => s.id !== sourceServerId)?.id ?? targets[0]?.id ?? null);
      setDir("~");
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader
          icon={<Send />}
          title={entries.length === 1 ? `Copy “${entries[0]!.name}” to…` : `Copy ${entries.length} items to…`}
          description="Streams through the control center. Progress appears under Transfers."
        />
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {targets.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setDest(s.id)}
                className={cn(
                  "tile rounded-xl px-3.5 py-2 text-[13px] font-medium transition hover:bg-tile-hover",
                  dest === s.id && "ring-2 ring-primary",
                )}
              >
                {s.name}
                {s.id === sourceServerId ? <span className="ml-1.5 text-[11.5px] text-subtle">(same)</span> : null}
              </button>
            ))}
          </div>
          <Field label="Destination folder" htmlFor="copy-dest" hint="Must exist. ~ is the remote user's home." error={error}>
            <Input id="copy-dest" value={dir} onChange={(e) => setDir(e.target.value)} className="font-mono" spellCheck={false} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="primary"
            disabled={dest == null || !dir.trim()}
            loading={pending}
            onClick={async () => {
              if (dest == null) return;
              setPending(true);
              setError(null);
              try {
                await onConfirm(dest, dir.trim());
                onOpenChange(false);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Failed");
              } finally {
                setPending(false);
              }
            }}
          >
            Start copy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
