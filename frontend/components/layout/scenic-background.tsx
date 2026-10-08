/**
 * Misty mountain landscape rendered as layered SVG, so no image download is needed.
 * Deterministic generation (seeded) keeps server and client markup identical.
 */

const VIEW_W = 1600;
const VIEW_H = 1000;

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function ridgePath(seed: number, baseY: number, amplitude: number, step: number): string {
  const rand = rng(seed);
  const phase = rand() * 10;
  let d = `M0,${VIEW_H} L0,${baseY}`;
  for (let x = 0; x <= VIEW_W + step; x += step) {
    const y =
      baseY -
      amplitude *
        (0.55 * Math.sin(x / 260 + phase) +
          0.3 * Math.sin(x / 113 + phase * 2) +
          0.15 * Math.sin(x / 47 + phase * 3) +
          (rand() - 0.5) * 0.25);
    d += ` L${x},${y.toFixed(1)}`;
  }
  return `${d} L${VIEW_W},${VIEW_H} Z`;
}

function pine(x: number, baseY: number, h: number): string {
  const levels = 6;
  const left: string[] = [];
  const right: string[] = [];
  for (let i = 1; i <= levels; i++) {
    const y = baseY - h + (i * h) / levels;
    const half = (i / levels) * h * 0.24;
    right.push(`${(x + half).toFixed(1)},${y.toFixed(1)}`, `${(x + half * 0.42).toFixed(1)},${(y - h * 0.02).toFixed(1)}`);
    left.unshift(`${(x - half * 0.42).toFixed(1)},${(y - h * 0.02).toFixed(1)}`, `${(x - half).toFixed(1)},${y.toFixed(1)}`);
  }
  return `M${x},${baseY - h} L${right.join(" L")} L${x + 3},${baseY + 40} L${x - 3},${baseY + 40} L${left.join(" L")} Z`;
}

function forest(seed: number, from: number, to: number, baseY: number, minH: number, maxH: number, density: number): string {
  const rand = rng(seed);
  const parts: string[] = [];
  for (let x = from; x < to; x += density * (0.6 + rand() * 0.8)) {
    // Trees grow taller toward the outer edge of the frame.
    const edge = 1 - Math.min(Math.abs(x - (from < 800 ? from : to)) / Math.abs(to - from), 1);
    const h = minH + (maxH - minH) * (0.35 * rand() + 0.65 * edge);
    parts.push(pine(x, baseY + rand() * 40, h));
  }
  return parts.join(" ");
}

const FAR = ridgePath(11, 560, 120, 24);
const MID = ridgePath(23, 650, 95, 20);
const NEAR = ridgePath(37, 760, 70, 16);
const FOREST_BACK = forest(5, -30, 470, 840, 110, 260, 26);
const FOREST_FRONT = forest(9, -40, 360, 930, 160, 420, 30);
const FOREST_RIGHT = forest(13, 1380, 1640, 900, 90, 260, 30);

export function ScenicBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-[linear-gradient(180deg,#d9e3ee_0%,#e6ecf3_38%,#eef1f4_100%)] dark:bg-[linear-gradient(180deg,#0a111d_0%,#0d1626_45%,#0b121e_100%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(60%_45%_at_68%_8%,rgb(255_255_255/0.95),transparent_70%)] dark:bg-[radial-gradient(50%_40%_at_68%_5%,rgb(90_120_180/0.18),transparent_70%)]" />
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMax slice"
        className="absolute inset-0 h-full w-full [--fog:#f3f6f9] [--m1:#c3d0dd] [--m2:#a8b9ca] [--m3:#8ea2b6] [--t1:#71879c] [--t2:#556b80] dark:[--fog:#0d1626] dark:[--m1:#1a2638] dark:[--m2:#18233a] dark:[--m3:#131d2f] dark:[--t1:#0f1828] dark:[--t2:#0a121f]"
      >
        <defs>
          <filter id="bg-blur-far"><feGaussianBlur stdDeviation="3" /></filter>
          <filter id="bg-blur-near"><feGaussianBlur stdDeviation="1.2" /></filter>
          <linearGradient id="bg-fog" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--fog)" stopOpacity="0" />
            <stop offset="55%" stopColor="var(--fog)" stopOpacity="0.85" />
            <stop offset="100%" stopColor="var(--fog)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="bg-ground" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--fog)" stopOpacity="0" />
            <stop offset="100%" stopColor="var(--fog)" stopOpacity="0.9" />
          </linearGradient>
        </defs>
        <path d={FAR} fill="var(--m1)" opacity="0.75" filter="url(#bg-blur-far)" />
        <rect x="0" y="470" width={VIEW_W} height="220" fill="url(#bg-fog)" />
        <path d={MID} fill="var(--m2)" opacity="0.55" filter="url(#bg-blur-far)" />
        <rect x="0" y="600" width={VIEW_W} height="200" fill="url(#bg-fog)" />
        <path d={NEAR} fill="var(--m3)" opacity="0.4" filter="url(#bg-blur-near)" />
        <path d={FOREST_BACK} fill="var(--t1)" opacity="0.45" filter="url(#bg-blur-far)" />
        <path d={FOREST_RIGHT} fill="var(--t1)" opacity="0.35" filter="url(#bg-blur-far)" />
        <rect x="0" y="760" width={VIEW_W} height="160" fill="url(#bg-fog)" opacity="0.8" />
        <path d={FOREST_FRONT} fill="var(--t2)" opacity="0.55" filter="url(#bg-blur-near)" />
        <rect x="0" y="820" width={VIEW_W} height="180" fill="url(#bg-ground)" />
      </svg>
    </div>
  );
}
