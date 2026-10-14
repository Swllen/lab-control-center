"use client";

import { useState } from "react";
import type { LiveMetrics } from "@/lib/metrics-store";
import { formatBytes } from "@/lib/format";
import { gpuUtilSeries, summarizeGpus } from "@/lib/metrics-derive";
import { cn, mean } from "@/lib/utils";

/**
 * A little creature per server whose mood follows its live metrics: asleep when idle, sweating when
 * busy, panting when hot, knocked out when unreachable. Pure SVG + CSS animations (see `.pet-*` in
 * globals.css), driven by the metrics the card already receives, so it costs no extra requests.
 */

export type PetMood = "connecting" | "sleep" | "idle" | "busy" | "hot" | "ko";

const HOT_C = 85;
const BUSY_GPU = 60;
const BUSY_CPU = 75;
const SLEEP_GPU = 5;
const SLEEP_CPU = 10;
/** Average over recent samples so the mood doesn't flicker on every spike. */
const SMOOTH = 5;

const BODY_COLORS = ["#7cc4ff", "#b49cff", "#6fdcae", "#ffc46b", "#ff9ec4", "#8fd3e8"];

interface PetStats {
  mood: PetMood;
  days: number;
  cpu: number;
  gpuUtil: number | null;
  gpuCount: number;
  busyGpus: number;
  idleGpus: number;
  maxTemp: number | null;
  vram: string | null;
}

function petStats(live: LiveMetrics): PetStats {
  const state = live.status?.state;
  const snap = live.latest;
  const gpu = summarizeGpus(live.static, snap);
  const recent = live.history.slice(-SMOOTH);
  const cpu = recent.length ? mean(recent.map((s) => s.cpu.percent)) : (snap?.cpu.percent ?? 0);
  const gpuUtil = gpu ? mean(gpuUtilSeries(recent.length ? recent : snap ? [snap] : [])) : null;
  const perGpu = snap?.gpus ?? [];

  let mood: PetMood;
  if (state === "offline" || state === "error") mood = "ko";
  else if (!snap) mood = "connecting";
  else if (gpu?.maxTemp != null && gpu.maxTemp >= HOT_C) mood = "hot";
  else if ((gpuUtil ?? 0) >= BUSY_GPU || cpu >= BUSY_CPU) mood = "busy";
  else if ((gpuUtil ?? 0) < SLEEP_GPU && cpu < SLEEP_CPU) mood = "sleep";
  else mood = "idle";

  return {
    mood,
    days: snap ? Math.floor(snap.uptime_s / 86400) : 0,
    cpu: Math.round(cpu),
    gpuUtil: gpuUtil == null ? null : Math.round(gpuUtil),
    gpuCount: perGpu.length,
    busyGpus: perGpu.filter((g) => g.utilization >= 50).length,
    idleGpus: perGpu.filter((g) => g.utilization < 5 && (!g.memory_total || g.memory_used / g.memory_total < 0.1)).length,
    maxTemp: gpu?.maxTemp != null ? Math.round(gpu.maxTemp) : null,
    vram: gpu ? formatBytes(gpu.memUsed) : null,
  };
}

/** Templated lines with live numbers filled in; null entries are skipped when their data is missing. */
function petLines(s: PetStats): string[] {
  const has = s.gpuCount > 0;
  const milestone = s.days > 0 && s.days % 100 === 0 ? [`今天是我连续运行的第 ${s.days} 天！🎉`] : [];
  const veteran = s.days >= 30 ? [`我已经连续上班 ${s.days} 天了，求放假`] : [];
  const lines: Record<PetMood, (string | null)[]> = {
    connecting: ["唔……正在醒来……", "等一下，我在找 SSH 钥匙"],
    sleep: [
      "zzZ……没人理我，我先睡了 💤",
      has ? `${s.gpuCount} 张卡都在摸鱼，快给我点活干` : null,
      `CPU 才 ${s.cpu}%，好无聊`,
      s.days ? `醒着 ${s.days} 天了，让我眯一会儿` : null,
    ],
    idle: [
      "今天也是元气满满的一天！",
      s.idleGpus ? `还有 ${s.idleGpus} 张卡空着哦，要不要开个实验？` : null,
      `CPU ${s.cpu}%，游刃有余~`,
      "今日宜：调学习率。忌：rm -rf",
      ...veteran,
    ],
    busy: [
      s.gpuUtil != null ? `正在努力炼丹中…… GPU ${s.gpuUtil}%` : `CPU ${s.cpu}%，在算了在算了`,
      s.vram ? `显存吃了 ${s.vram}，有点撑` : null,
      "别催别催，在算了在算了",
      s.busyGpus ? `${s.busyGpus} 张卡满负荷运转中 💪` : null,
      "loss 降了吗？降了吗？",
      ...veteran,
    ],
    hot: [
      s.maxTemp != null ? `好热好热……${s.maxTemp}°C 了！` : "好热好热……",
      "我感觉自己是个电暖气 🔥",
      "谁能给我开个空调……",
      s.gpuUtil != null ? `GPU ${s.gpuUtil}% 还这么热，我尽力了` : null,
    ],
    ko: ["我……晕了…… 💫", "连不上我了？我也不知道发生了什么", "（倒地不起）", "是不是有人拔了我的网线"],
  };
  return [...milestone, ...lines[s.mood].filter((l): l is string => !!l)];
}

const MOOD_LABEL: Record<PetMood, string> = {
  connecting: "waking up",
  sleep: "asleep",
  idle: "relaxed",
  busy: "busy",
  hot: "overheating",
  ko: "knocked out",
};

function colorFor(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return BODY_COLORS[h % BODY_COLORS.length] ?? BODY_COLORS[0]!;
}

export function ServerPet({ live, seed, className }: { live: LiveMetrics; seed: string; className?: string }) {
  const stats = petStats(live);
  const lines = petLines(stats);
  // Index into `lines` while the bubble is open: hover/focus picks a random line, clicking cycles.
  const [line, setLine] = useState<number | null>(null);
  const shown = line != null ? lines[line % lines.length] : null;

  return (
    <div className={cn("relative shrink-0", className)}>
      <button
        type="button"
        aria-label={`Server mascot, ${MOOD_LABEL[stats.mood]}. ${shown ?? ""}`}
        onMouseEnter={() => setLine(Math.floor(Math.random() * lines.length))}
        onMouseLeave={() => setLine(null)}
        onFocus={() => setLine((l) => l ?? Math.floor(Math.random() * lines.length))}
        onBlur={() => setLine(null)}
        onClick={() => setLine((l) => (l ?? -1) + 1)}
        className="grid size-[52px] place-items-center rounded-2xl bg-gradient-to-b from-white to-slate-100 shadow-tile ring-1 ring-black/[0.04] transition hover:scale-105 dark:from-slate-700 dark:to-slate-800"
      >
        <PetSvg mood={stats.mood} color={colorFor(seed)} />
      </button>
      {shown ? (
        <div
          role="status"
          className="glass-strong pointer-events-none absolute left-0 top-full z-30 mt-2 w-max max-w-[240px] rounded-2xl px-3 py-2 text-[12.5px] leading-snug text-fg animate-pop-in"
        >
          <span className="absolute -top-1.5 left-5 size-3 rotate-45 border-l border-t border-glass-border bg-[var(--glass-strong)]" />
          {shown}
        </div>
      ) : null}
    </div>
  );
}

const INK = "#1c2738";

export function PetSvg({ mood, color }: { mood: PetMood; color: string }) {
  const body = mood === "ko" ? "#b9c2cd" : mood === "hot" ? "#ff8f6b" : color;
  const led = { connecting: "#94a0b1", sleep: "#94a0b1", idle: "#22b45a", busy: "#2f6bff", hot: "#e5484d", ko: "#66738a" }[mood];

  return (
    <svg viewBox="0 0 52 52" className={cn("size-[46px] overflow-visible", `pet pet-${mood}`)} aria-hidden>
      <g className="pet-body">
        {/* antenna with a status LED */}
        <path d="M26 15 V8" stroke={INK} strokeWidth="1.6" strokeLinecap="round" opacity="0.7" />
        <circle className="pet-led" cx="26" cy="7" r="2.6" fill={led} />
        {/* feet */}
        <ellipse cx="19" cy="44" rx="4.5" ry="2.6" fill={body} style={{ filter: "brightness(0.85)" }} />
        <ellipse cx="33" cy="44" rx="4.5" ry="2.6" fill={body} style={{ filter: "brightness(0.85)" }} />
        {/* body */}
        <path d="M26 15 C38 15 43 23 43 31 C43 39 36 44 26 44 C16 44 9 39 9 31 C9 23 14 15 26 15 Z" fill={body} />
        <path d="M17 20 C20 17.5 23 17 25 17" stroke="white" strokeWidth="2" strokeLinecap="round" opacity="0.55" fill="none" />
        {/* cheeks */}
        {mood !== "ko" ? (
          <>
            <ellipse cx="15.5" cy="33.5" rx="3" ry="1.8" fill="#ff6b8a" opacity={mood === "hot" ? 0.75 : 0.35} />
            <ellipse cx="36.5" cy="33.5" rx="3" ry="1.8" fill="#ff6b8a" opacity={mood === "hot" ? 0.75 : 0.35} />
          </>
        ) : null}
        <Face mood={mood} />
      </g>
      <Extras mood={mood} />
    </svg>
  );
}

function Face({ mood }: { mood: PetMood }) {
  const stroke = { stroke: INK, strokeWidth: 1.8, strokeLinecap: "round" as const, fill: "none" };
  switch (mood) {
    case "sleep":
      return (
        <>
          <path d="M18 29 q2.5 2.2 5 0" {...stroke} />
          <path d="M29 29 q2.5 2.2 5 0" {...stroke} />
          <ellipse cx="26" cy="35.5" rx="1.6" ry="1.9" fill={INK} opacity="0.75" />
        </>
      );
    case "connecting":
      return (
        <>
          <path d="M18 29 h5" {...stroke} />
          <path d="M29 29 h5" {...stroke} />
          <path d="M24 35 h4" {...stroke} />
        </>
      );
    case "busy":
      return (
        <>
          <path d="M17.5 24.5 l5 1.6" {...stroke} />
          <path d="M34.5 24.5 l-5 1.6" {...stroke} />
          <g className="pet-eyes">
            <ellipse cx="20.5" cy="29" rx="2" ry="2.4" fill={INK} />
            <ellipse cx="31.5" cy="29" rx="2" ry="2.4" fill={INK} />
          </g>
          <path d="M23 35.2 h6" {...stroke} />
        </>
      );
    case "hot":
      return (
        <>
          <path d="M18 27 l4 2 l-4 2" {...stroke} />
          <path d="M34 27 l-4 2 l4 2" {...stroke} />
          <path d="M22.5 34 q3.5 2.5 7 0" {...stroke} />
          <path className="pet-tongue" d="M24.5 35.3 q1.5 4.2 3 0 z" fill="#ff5c7a" />
        </>
      );
    case "ko":
      return (
        <>
          <path d="M18 26.5 l4.5 4.5 M22.5 26.5 l-4.5 4.5" {...stroke} />
          <path d="M29.5 26.5 l4.5 4.5 M34 26.5 l-4.5 4.5" {...stroke} />
          <path d="M22 36 q1 -1.5 2 0 t2 0 t2 0 t2 0" {...stroke} strokeWidth={1.5} />
        </>
      );
    default:
      return (
        <>
          <g className="pet-eyes">
            <ellipse cx="20.5" cy="28.5" rx="2.1" ry="2.6" fill={INK} />
            <ellipse cx="31.5" cy="28.5" rx="2.1" ry="2.6" fill={INK} />
            <circle cx="21.2" cy="27.6" r="0.7" fill="white" />
            <circle cx="32.2" cy="27.6" r="0.7" fill="white" />
          </g>
          <path d="M23 34 q3 2.6 6 0" {...stroke} />
        </>
      );
  }
}

function Extras({ mood }: { mood: PetMood }) {
  switch (mood) {
    case "sleep":
      return (
        <g fill="#5f6d80" fontWeight="700" fontFamily="var(--font-sans)">
          <text className="pet-z pet-z1" x="38" y="16" fontSize="7">z</text>
          <text className="pet-z pet-z2" x="38" y="16" fontSize="9">Z</text>
        </g>
      );
    case "busy":
      return <path className="pet-sweat" d="M41 17 q2.4 3.6 0 5 q-2.4 -1.4 0 -5 z" fill="#5fb8ff" />;
    case "hot":
      return (
        <g stroke="#ff8f6b" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.8">
          <path className="pet-steam pet-steam1" d="M15 12 q-2 -2.5 0 -5 t0 -5" />
          <path className="pet-steam pet-steam2" d="M37 12 q-2 -2.5 0 -5 t0 -5" />
          <path className="pet-sweat" d="M42 19 q2.4 3.6 0 5 q-2.4 -1.4 0 -5 z" fill="#5fb8ff" stroke="none" />
        </g>
      );
    case "ko":
      return (
        <g className="pet-stars" fill="#f2b23a">
          <path d="M14 9 l1 2.2 2.3 .3 -1.7 1.6 .4 2.3 -2 -1.1 -2 1.1 .4 -2.3 -1.7 -1.6 2.3 -.3 z" />
          <path d="M38 9 l.8 1.7 1.8 .2 -1.3 1.2 .3 1.8 -1.6 -.9 -1.6 .9 .3 -1.8 -1.3 -1.2 1.8 -.2 z" />
        </g>
      );
    default:
      return null;
  }
}
