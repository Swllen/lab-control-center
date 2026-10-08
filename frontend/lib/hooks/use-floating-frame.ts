"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ResizeEdges {
  left?: boolean;
  right?: boolean;
  top?: boolean;
  bottom?: boolean;
}

/** The eight resize handles of a window: edges and corners, with their cursors. */
export const RESIZE_HANDLES: { edges: ResizeEdges; className: string; label: string }[] = [
  { edges: { top: true }, className: "inset-x-3 top-0 h-1.5 cursor-ns-resize", label: "上边" },
  { edges: { bottom: true }, className: "inset-x-3 bottom-0 h-1.5 cursor-ns-resize", label: "下边" },
  { edges: { left: true }, className: "inset-y-3 left-0 w-1.5 cursor-ew-resize", label: "左边" },
  { edges: { right: true }, className: "inset-y-3 right-0 w-1.5 cursor-ew-resize", label: "右边" },
  { edges: { top: true, left: true }, className: "left-0 top-0 size-3 cursor-nwse-resize", label: "左上角" },
  { edges: { top: true, right: true }, className: "right-0 top-0 size-3 cursor-nesw-resize", label: "右上角" },
  { edges: { bottom: true, left: true }, className: "bottom-0 left-0 size-3 cursor-nesw-resize", label: "左下角" },
  { edges: { bottom: true, right: true }, className: "bottom-0 right-0 size-4 cursor-nwse-resize", label: "右下角" },
];

const MIN_W = 320;
const MIN_H = 320;
const MARGIN = 8;

function clamp(f: Frame): Frame {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(Math.max(f.w, MIN_W), vw - MARGIN * 2);
  const h = Math.min(Math.max(f.h, MIN_H), vh - MARGIN * 2);
  return {
    w,
    h,
    x: Math.min(Math.max(f.x, MARGIN), vw - w - MARGIN),
    y: Math.min(Math.max(f.y, MARGIN), vh - h - MARGIN),
  };
}

function load(key: string): Frame | null {
  try {
    const f = JSON.parse(window.localStorage.getItem(key) ?? "null") as Frame | null;
    return f && [f.x, f.y, f.w, f.h].every(Number.isFinite) ? f : null;
  } catch {
    return null;
  }
}

function save(key: string, f: Frame): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(f));
  } catch {
    /* storage unavailable */
  }
}

/**
 * A draggable / resizable fixed-position frame, kept inside the viewport and remembered in
 * localStorage. Returns pointer-down handlers for the drag handle and the resize grip.
 */
export function useFloatingFrame(storageKey: string, enabled: boolean) {
  const [frame, setFrameState] = useState<Frame | null>(null);
  const current = useRef<Frame | null>(null);
  const setFrame = useCallback((f: Frame) => {
    current.current = f;
    setFrameState(f);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const vh = window.innerHeight;
    const h = Math.min(600, vh - 140);
    const initial = load(storageKey) ?? { w: 400, h, x: window.innerWidth - 400 - 28, y: vh - h - 28 };
    setFrame(clamp(initial));
    const onResize = () => current.current && setFrame(clamp(current.current));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [enabled, storageKey, setFrame]);

  const track = useCallback(
    (e: ReactPointerEvent, apply: (start: Frame, dx: number, dy: number) => Frame) => {
      const start = current.current;
      if (!start || e.button !== 0) return;
      e.preventDefault();
      const sx = e.clientX;
      const sy = e.clientY;
      const prevSelect = document.body.style.userSelect;
      document.body.style.userSelect = "none";
      const move = (ev: PointerEvent) => setFrame(clamp(apply(start, ev.clientX - sx, ev.clientY - sy)));
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        document.body.style.userSelect = prevSelect;
        if (current.current) save(storageKey, current.current);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    },
    [setFrame, storageKey],
  );

  /** Drag from the title bar; presses on interactive controls are ignored. */
  const startDrag = useCallback(
    (e: ReactPointerEvent) => {
      if ((e.target as HTMLElement).closest("button, select, input, textarea, a, label")) return;
      track(e, (f, dx, dy) => ({ ...f, x: f.x + dx, y: f.y + dy }));
    },
    [track],
  );

  /**
   * Resize from any edge or corner. Left/top edges move the origin so the opposite edge stays put,
   * and stop at the minimum size instead of pushing the window.
   */
  const startResize = useCallback(
    (e: ReactPointerEvent, edges: ResizeEdges) => {
      e.stopPropagation();
      track(e, (f, dx, dy) => {
        // Each dragged edge stops at the viewport margin; the opposite edge never moves.
        let { x, y, w, h } = f;
        if (edges.right) w = Math.min(f.w + dx, window.innerWidth - MARGIN - f.x);
        if (edges.bottom) h = Math.min(f.h + dy, window.innerHeight - MARGIN - f.y);
        if (edges.left) {
          w = Math.min(Math.max(MIN_W, f.w - dx), f.x + f.w - MARGIN);
          x = f.x + (f.w - w);
        }
        if (edges.top) {
          h = Math.min(Math.max(MIN_H, f.h - dy), f.y + f.h - MARGIN);
          y = f.y + (f.h - h);
        }
        return { x, y, w, h };
      });
    },
    [track],
  );

  return { frame, startDrag, startResize };
}
