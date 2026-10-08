"use client";

import * as Menu from "@radix-ui/react-dropdown-menu";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  align = "end",
  ...props
}: ComponentPropsWithoutRef<typeof Menu.Content>) {
  return (
    <Menu.Portal>
      <Menu.Content
        sideOffset={sideOffset}
        align={align}
        className={cn(
          "glass-strong z-50 min-w-[200px] rounded-2xl p-1.5 animate-fade-in focus:outline-none",
          className,
        )}
        {...props}
      />
    </Menu.Portal>
  );
}

export function DropdownMenuItem({
  className,
  tone,
  ...props
}: ComponentPropsWithoutRef<typeof Menu.Item> & { tone?: "danger" }) {
  return (
    <Menu.Item
      className={cn(
        "flex cursor-default select-none items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] outline-none",
        "data-[disabled]:opacity-45 [&_svg]:size-4 [&_svg]:text-muted",
        tone === "danger"
          ? "text-danger data-[highlighted]:bg-danger-soft [&_svg]:!text-danger"
          : "data-[highlighted]:bg-primary-soft data-[highlighted]:text-fg",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuLabel({ className, ...props }: ComponentPropsWithoutRef<typeof Menu.Label>) {
  return <Menu.Label className={cn("px-2.5 pb-1 pt-1.5 text-[11.5px] font-medium text-subtle", className)} {...props} />;
}

export function DropdownMenuSeparator({ className, ...props }: ComponentPropsWithoutRef<typeof Menu.Separator>) {
  return <Menu.Separator className={cn("mx-1 my-1.5 h-px bg-line", className)} {...props} />;
}
