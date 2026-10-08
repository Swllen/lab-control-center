"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  hideClose,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { hideClose?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-slate-900/20 backdrop-blur-[3px] animate-fade-in dark:bg-black/45" />
      <DialogPrimitive.Content
        className={cn(
          "glass-strong fixed left-1/2 top-1/2 z-50 w-[calc(100vw-32px)] max-w-lg -translate-x-1/2 -translate-y-1/2",
          "max-h-[calc(100vh-32px)] overflow-y-auto rounded-[24px] p-6 animate-pop-in focus:outline-none",
          className,
        )}
        {...props}
      >
        {children}
        {hideClose ? null : (
          <DialogPrimitive.Close
            className="absolute right-4 top-4 rounded-full p-1.5 text-subtle transition hover:bg-track hover:text-fg"
            aria-label="Close"
          >
            <X className="size-4" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({
  icon,
  title,
  description,
  tone = "default",
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  tone?: "default" | "danger";
}) {
  return (
    <div className="mb-5 flex items-start gap-3.5 pr-6">
      {icon ? (
        <div
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-xl [&_svg]:size-5",
            tone === "danger" ? "bg-danger-soft text-danger" : "bg-primary-soft text-primary",
          )}
        >
          {icon}
        </div>
      ) : null}
      <div className="min-w-0">
        <DialogPrimitive.Title className="text-[17px] font-semibold tracking-[-0.01em]">{title}</DialogPrimitive.Title>
        {description ? (
          <DialogPrimitive.Description className="mt-1 text-[13px] leading-relaxed text-muted">
            {description}
          </DialogPrimitive.Description>
        ) : (
          <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
        )}
      </div>
    </div>
  );
}

export function DialogFooter({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("mt-6 flex items-center justify-end gap-2.5", className)}>{children}</div>;
}
