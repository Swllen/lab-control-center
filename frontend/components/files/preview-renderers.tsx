"use client";

import { ChevronRight, ChevronsDownUp, ChevronsUpDown, Search } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type PreviewMode = "text" | "json" | "jsonl" | "markdown" | "csv" | "image";

/** Must match the backend's inline image whitelist (/preview/raw). */
export const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|ico|avif|svg)$/i;
export const IMAGE_MAX_BYTES = 25 * 1024 * 1024;

export function previewModeFor(name: string): PreviewMode {
  if (IMAGE_RE.test(name)) return "image";
  if (/\.(jsonl|ndjson)$/i.test(name)) return "jsonl";
  if (/\.json$/i.test(name)) return "json";
  if (/\.(md|markdown)$/i.test(name)) return "markdown";
  if (/\.(csv|tsv)$/i.test(name)) return "csv";
  return "text";
}

/** Rows rendered per "Show more" step in record/table views. */
const PAGE = 1000;
/** Above this, wrapped (one element per line) rendering gets too heavy; fall back to no-wrap. */
const WRAP_MAX_LINES = 20_000;
/** Above this, syntax highlighting costs more than it is worth. */
const HIGHLIGHT_MAX_CHARS = 300_000;

function splitLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Drop the partial last line of a truncated read so record/table views never show half a row. */
export function completeText(text: string, truncated: boolean): string {
  if (!truncated || text.endsWith("\n")) return text;
  const cut = text.lastIndexOf("\n");
  return cut > 0 ? text.slice(0, cut + 1) : text;
}

export function Notice({ tone = "warning", children }: { tone?: "warning" | "danger"; children: ReactNode }) {
  return (
    <div
      className={cn(
        "mb-3 rounded-xl px-3 py-2 text-[12.5px]",
        tone === "danger" ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning",
      )}
    >
      {children}
    </div>
  );
}

function ShowMore({ shown, total, onMore }: { shown: number; total: number; onMore: () => void }) {
  if (shown >= total) return null;
  return (
    <div className="flex items-center justify-center gap-3 py-3 text-[12.5px] text-muted">
      <span className="tabular">
        Showing {shown.toLocaleString()} of {total.toLocaleString()}
      </span>
      <Button size="sm" variant="secondary" onClick={onMore}>
        Show {Math.min(PAGE, total - shown).toLocaleString()} more
      </Button>
    </div>
  );
}

// ------------------------------------------------------------------ JSON highlighting

const JSON_TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

export function highlightJson(src: string): ReactNode[] {
  if (src.length > HIGHLIGHT_MAX_CHARS) return [src];
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of src.matchAll(JSON_TOKEN)) {
    const i = m.index;
    if (i > last) out.push(src.slice(last, i));
    if (m[1]) {
      out.push(<span key={k++} className={m[2] ? "text-primary" : "text-success"}>{m[1]}</span>);
      if (m[2]) out.push(m[2]);
    } else if (m[3]) {
      out.push(<span key={k++} className="text-violet">{m[3]}</span>);
    } else {
      out.push(<span key={k++} className="text-warning">{m[0]}</span>);
    }
    last = i + m[0].length;
  }
  if (last < src.length) out.push(src.slice(last));
  return out;
}

// ------------------------------------------------------------------ plain text / code

export function CodeView({
  text,
  wrap,
  highlight,
}: {
  text: string;
  wrap: boolean;
  highlight?: (src: string) => ReactNode[];
}) {
  const lines = useMemo(() => splitLines(text), [text]);
  const gutter = useMemo(() => lines.map((_, i) => i + 1).join("\n"), [lines]);
  const body = useMemo(() => (highlight && !wrap ? highlight(text) : text), [highlight, text, wrap]);
  const width = `${String(lines.length).length + 2}ch`;

  if (wrap && lines.length <= WRAP_MAX_LINES) {
    return (
      <div className="py-3 font-mono text-[12.5px] leading-[1.6]">
        {lines.map((line, i) => (
          <div key={i} className="flex">
            <span className="shrink-0 select-none pr-4 text-right text-subtle" style={{ width }}>
              {i + 1}
            </span>
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-words pr-5">
              {line ? (highlight ? highlight(line) : line) : " "}
            </span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="flex min-w-max py-3 font-mono text-[12.5px] leading-[1.6]">
      <pre
        aria-hidden
        className="sticky left-0 shrink-0 select-none bg-glass-strong pr-4 text-right text-subtle backdrop-blur-xl"
        style={{ width }}
      >
        {gutter}
      </pre>
      <pre className="pr-6">{body}</pre>
    </div>
  );
}

export function JsonView({ text, truncated, wrap }: { text: string; truncated: boolean; wrap: boolean }) {
  const parsed = useMemo(() => {
    try {
      return { ok: true as const, pretty: JSON.stringify(JSON.parse(text), null, 2) };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : "Invalid JSON" };
    }
  }, [text]);
  if (!parsed.ok) {
    return (
      <div className="px-5 pt-3">
        <Notice>
          {truncated ? "Only the start of this file was loaded, so it can't be formatted. Showing raw text." : `Invalid JSON: ${parsed.error}`}
        </Notice>
        <div className="-mx-5">
          <CodeView text={text} wrap={wrap} />
        </div>
      </div>
    );
  }
  return <CodeView text={parsed.pretty} wrap={wrap} highlight={highlightJson} />;
}

// ------------------------------------------------------------------ JSON Lines

interface JsonlRecord {
  n: number;
  raw: string;
  value?: unknown;
  error?: string;
}

function compactValue(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return v.length <= 6 && v.every((x) => typeof x !== "object" || x === null) ? JSON.stringify(v) : `[${v.length}]`;
  if (typeof v === "object") return `{${Object.keys(v as object).length}}`;
  if (typeof v === "string") return JSON.stringify(v.length > 60 ? `${v.slice(0, 60)}…` : v);
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(6)));
  return String(v);
}

/** One-line `key value · key value` summary, so episode/step logs are skimmable collapsed. */
function RecordSummary({ rec }: { rec: JsonlRecord }) {
  if (rec.error) return <span className="text-danger">{rec.raw.slice(0, 400)}</span>;
  const v = rec.value;
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const entries = Object.entries(v as Record<string, unknown>).slice(0, 14);
    return (
      <>
        {entries.map(([k, val], i) => (
          <span key={k}>
            {i > 0 ? <span className="px-1.5 text-subtle">·</span> : null}
            <span className="text-primary">{k}</span> <span>{compactValue(val)}</span>
          </span>
        ))}
      </>
    );
  }
  return <>{highlightJson(rec.raw.slice(0, 400))}</>;
}

export function JsonlView({ text, truncated }: { text: string; truncated: boolean }) {
  const records = useMemo<JsonlRecord[]>(() => {
    const out: JsonlRecord[] = [];
    splitLines(completeText(text, truncated)).forEach((raw, i) => {
      if (!raw.trim()) return;
      try {
        out.push({ n: i + 1, raw, value: JSON.parse(raw) });
      } catch (err) {
        out.push({ n: i + 1, raw, error: err instanceof Error ? err.message : "Invalid JSON" });
      }
    });
    return out;
  }, [text, truncated]);
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [limit, setLimit] = useState(PAGE);

  const needle = filter.trim().toLowerCase();
  const matches = useMemo(
    () => (needle ? records.filter((r) => r.raw.toLowerCase().includes(needle)) : records),
    [records, needle],
  );
  const shown = matches.slice(0, limit);
  const invalid = records.filter((r) => r.error).length;
  const allOpen = shown.length > 0 && shown.every((r) => open.has(r.n));

  const toggle = (n: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });

  return (
    <div className="pb-3">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-glass-strong px-4 py-2 backdrop-blur-xl">
        <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg bg-track px-2.5 text-[12.5px]">
          <Search className="size-3.5 shrink-0 text-subtle" />
          <input
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setLimit(PAGE);
            }}
            placeholder="Filter records…"
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-subtle"
            aria-label="Filter records"
          />
        </label>
        <span className="tabular shrink-0 text-[12px] text-muted">
          {needle ? `${matches.length.toLocaleString()} of ` : ""}
          {records.length.toLocaleString()} record{records.length === 1 ? "" : "s"}
          {invalid ? <span className="text-danger"> · {invalid} invalid</span> : null}
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setOpen(allOpen ? new Set() : new Set(shown.map((r) => r.n)))}
          title={allOpen ? "Collapse all" : "Expand all shown records"}
        >
          {allOpen ? <ChevronsDownUp /> : <ChevronsUpDown />}
          {allOpen ? "Collapse" : "Expand"}
        </Button>
      </div>
      {shown.map((rec) => {
        const isOpen = open.has(rec.n);
        return (
          <div key={rec.n} className="border-b border-line/60">
            <button
              type="button"
              onClick={() => toggle(rec.n)}
              className={cn(
                "flex w-full items-start gap-2 px-4 py-1.5 text-left font-mono text-[12px] leading-[1.55] transition-colors",
                isOpen ? "bg-primary-soft" : "hover:bg-tile-hover/70",
              )}
              aria-expanded={isOpen}
            >
              <ChevronRight className={cn("mt-[3px] size-3.5 shrink-0 text-subtle transition-transform", isOpen && "rotate-90")} />
              <span className="tabular w-12 shrink-0 text-right text-subtle">{rec.n}</span>
              <span className={cn("min-w-0 flex-1", isOpen ? "whitespace-normal break-words" : "truncate")}>
                <RecordSummary rec={rec} />
              </span>
            </button>
            {isOpen ? (
              <pre className="overflow-x-auto border-t border-line/60 py-2.5 pl-[92px] pr-4 font-mono text-[12px] leading-[1.6]">
                {rec.error ? (
                  <>
                    <span className="text-danger">{rec.error}</span>
                    {"\n"}
                    {rec.raw}
                  </>
                ) : (
                  highlightJson(JSON.stringify(rec.value, null, 2))
                )}
              </pre>
            ) : null}
          </div>
        );
      })}
      {needle && matches.length === 0 ? <p className="py-8 text-center text-[13px] text-muted">No records match “{filter}”.</p> : null}
      <ShowMore shown={shown.length} total={matches.length} onMore={() => setLimit((l) => l + PAGE)} />
    </div>
  );
}

// ------------------------------------------------------------------ CSV / TSV

function parseDelimited(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let fieldStart = true;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && fieldStart) {
      quoted = true;
      fieldStart = false;
    } else if (c === delim) {
      row.push(field);
      field = "";
      fieldStart = true;
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      fieldStart = true;
    } else {
      field += c;
      fieldStart = false;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const NUMERIC = /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?%?\s*$/;

export function CsvView({ text, truncated, tsv }: { text: string; truncated: boolean; tsv: boolean }) {
  const rows = useMemo(() => parseDelimited(completeText(text, truncated), tsv ? "\t" : ","), [text, truncated, tsv]);
  const [limit, setLimit] = useState(PAGE);
  const [header, ...body] = rows;
  const width = Math.max(0, ...rows.slice(0, 200).map((r) => r.length));
  // Right-align columns that are mostly numbers (losses, rewards, step counts).
  const numeric = useMemo(
    () =>
      Array.from({ length: width }, (_, c) => {
        const sample = rows.slice(1, 101).map((r) => r[c] ?? "").filter((v) => v.trim());
        return sample.length > 0 && sample.filter((v) => NUMERIC.test(v)).length / sample.length >= 0.8;
      }),
    [rows, width],
  );
  if (!header) return <p className="py-8 text-center text-[13px] text-muted">No rows.</p>;
  const cols = Array.from({ length: width }, (_, i) => i);
  return (
    <div className="pb-3">
      <table className="min-w-full border-separate border-spacing-0 text-[12.5px]">
        <thead className="sticky top-0 z-10 bg-glass-strong backdrop-blur-xl">
          <tr className="text-left [&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-line [&_th]:px-3 [&_th]:py-2 [&_th]:font-semibold">
            <th className="w-12 text-right font-normal! text-subtle">#</th>
            {cols.map((c) => (
              <th key={c} className={cn(numeric[c] && "text-right")}>
                {header[c] ?? ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.slice(0, limit).map((r, i) => (
            <tr key={i} className="hover:bg-tile-hover/70 [&_td]:border-b [&_td]:border-line/60 [&_td]:px-3 [&_td]:py-1.5">
              <td className="tabular text-right text-subtle">{i + 1}</td>
              {cols.map((c) => (
                <td
                  key={c}
                  className={cn("max-w-[420px] truncate", numeric[c] && "tabular text-right font-mono text-[12px]")}
                  title={(r[c] ?? "").length > 40 ? r[c] : undefined}
                >
                  {r[c] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <ShowMore shown={Math.min(limit, body.length)} total={body.length} onMore={() => setLimit((l) => l + PAGE)} />
    </div>
  );
}

// ------------------------------------------------------------------ Markdown

type ResolveUrl = (src: string) => string | null;

const INLINE =
  /\\(?<esc>[\\`*_{}[\]()#+\-.!|~<>])|(?<tick>`+)(?<code>[\s\S]*?[^`])\k<tick>(?!`)|!\[(?<alt>[^\]]*)\]\(\s*<?(?<src>[^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)|\[(?<text>(?:[^[\]]|\[[^\]]*\])+)\]\(\s*<?(?<href>[^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)|\*\*(?=\S)(?<strong>[\s\S]*?\S)\*\*|__(?=\S)(?<strong2>[\s\S]*?\S)__(?!\w)|(?<![\w*])\*(?=[^\s*])(?<em>[^*]*?[^\s*])\*(?!\w)|(?<!\w)_(?=[^\s_])(?<em2>[^_]*?[^\s_])_(?!\w)|~~(?=\S)(?<del>[\s\S]*?\S)~~|<(?<auto>https?:\/\/[^\s>]+)>|(?<bare>https?:\/\/[^\s<]*[^\s<.,;:!?)\]'"*_])/g;

function safeHref(href: string): string | null {
  return /^(https?:|mailto:)/i.test(href) ? href : null;
}

function renderInline(src: string, resolve: ResolveUrl, keyPrefix = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  const key = () => `${keyPrefix}${k++}`;
  for (const m of src.matchAll(INLINE)) {
    const g = m.groups!;
    if (m.index > last) out.push(src.slice(last, m.index));
    last = m.index + m[0].length;
    if (g.esc !== undefined) out.push(g.esc);
    else if (g.code !== undefined)
      out.push(
        <code key={key()} className="rounded-md bg-track px-1.5 py-0.5 font-mono text-[0.88em]">
          {g.code.trim() || g.code}
        </code>,
      );
    else if (g.src !== undefined) {
      const url = resolve(g.src);
      out.push(
        url ? (
          <img key={key()} src={url} alt={g.alt ?? ""} className="inline max-w-full rounded-md align-middle" />
        ) : (
          <span key={key()} className="text-subtle">[image: {g.alt || g.src}]</span>
        ),
      );
    } else if (g.text !== undefined) {
      const href = safeHref(g.href!);
      const inner = renderInline(g.text, resolve, `${keyPrefix}${k}-`);
      out.push(
        href ? (
          <a key={key()} href={href} target="_blank" rel="noreferrer noopener" className="text-primary underline-offset-2 hover:underline">
            {inner}
          </a>
        ) : (
          <span key={key()} className="text-primary" title={g.href}>
            {inner}
          </span>
        ),
      );
    } else if (g.strong !== undefined || g.strong2 !== undefined)
      out.push(<strong key={key()} className="font-semibold">{renderInline((g.strong ?? g.strong2)!, resolve, `${keyPrefix}${k}-`)}</strong>);
    else if (g.em !== undefined || g.em2 !== undefined)
      out.push(<em key={key()}>{renderInline((g.em ?? g.em2)!, resolve, `${keyPrefix}${k}-`)}</em>);
    else if (g.del !== undefined) out.push(<del key={key()}>{renderInline(g.del, resolve, `${keyPrefix}${k}-`)}</del>);
    else {
      const url = (g.auto ?? g.bare)!;
      out.push(
        <a key={key()} href={url} target="_blank" rel="noreferrer noopener" className="break-all text-primary underline-offset-2 hover:underline">
          {url}
        </a>,
      );
    }
  }
  if (last < src.length) out.push(src.slice(last));
  return out;
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+#.-]*)/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>/;
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function startsBlock(line: string, next: string | undefined): boolean {
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    HR.test(line) ||
    QUOTE.test(line) ||
    LIST_ITEM.test(line) ||
    (line.includes("|") && next !== undefined && TABLE_SEP.test(next))
  );
}

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function renderBlocks(lines: string[], resolve: ResolveUrl, keyPrefix = "b"): ReactNode[] {
  const out: ReactNode[] = [];
  let i = 0;
  let k = 0;
  const key = () => `${keyPrefix}${k++}`;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1]!;
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trimStart().startsWith(marker)) body.push(lines[i++]!);
      i++;
      out.push(
        <pre key={key()} className="my-3 overflow-x-auto rounded-xl bg-track px-4 py-3 font-mono text-[12.5px] leading-[1.6]">
          <code>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      const Tag = `h${level}` as "h1";
      const size = ["text-[22px] border-b border-line pb-2", "text-[19px] border-b border-line pb-1.5", "text-[16.5px]", "text-[15px]", "text-[14px]", "text-[13px] text-muted"][level - 1];
      out.push(
        <Tag key={key()} className={cn("mb-3 mt-6 font-semibold tracking-[-0.01em] first:mt-0", size)}>
          {renderInline(heading[2]!, resolve)}
        </Tag>,
      );
      i++;
      continue;
    }

    if (HR.test(line)) {
      out.push(<hr key={key()} className="my-5 border-line" />);
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && lines[i]!.trim() && (QUOTE.test(lines[i]!) || !startsBlock(lines[i]!, lines[i + 1])))
        body.push(lines[i++]!.replace(/^\s{0,3}> ?/, ""));
      out.push(
        <blockquote key={key()} className="my-3 border-l-[3px] border-primary/40 pl-4 text-muted">
          {renderBlocks(body, resolve, `${key()}-`)}
        </blockquote>,
      );
      continue;
    }

    if (line.includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]!)) {
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]!).map((c) => (c.endsWith(":") ? (c.startsWith(":") ? "center" : "right") : "left") as "left");
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim() && lines[i]!.includes("|")) rows.push(splitRow(lines[i++]!));
      out.push(
        <div key={key()} className="my-3 overflow-x-auto">
          <table className="border-separate border-spacing-0 text-[13px] [&_td]:border-b [&_td]:border-line [&_td]:px-3 [&_td]:py-1.5 [&_th]:border-b [&_th]:border-line [&_th]:px-3 [&_th]:py-1.5 [&_th]:font-semibold">
            <thead>
              <tr>
                {head.map((c, j) => (
                  <th key={j} style={{ textAlign: align[j] ?? "left" }}>{renderInline(c, resolve)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {head.map((_, j) => (
                    <td key={j} style={{ textAlign: align[j] ?? "left" }}>{renderInline(r[j] ?? "", resolve)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    const item = LIST_ITEM.exec(line);
    if (item) {
      const base = item[1]!.length;
      const ordered = /\d/.test(item[2]!);
      const start = ordered ? parseInt(item[2]!, 10) : undefined;
      const items: string[][] = [];
      while (i < lines.length) {
        const cur = lines[i]!;
        const m = LIST_ITEM.exec(cur);
        if (m && m[1]!.length <= base + 1 && /\d/.test(m[2]!) === ordered) {
          items.push([m[3]!]);
          i++;
        } else if (!cur.trim()) {
          const next = lines[i + 1];
          if (next === undefined || !next.trim()) break;
          const nm = LIST_ITEM.exec(next);
          if (indentOf(next) > base || (nm && nm[1]!.length <= base + 1)) {
            items[items.length - 1]!.push("");
            i++;
          } else break;
        } else if (indentOf(cur) > base || !startsBlock(cur, lines[i + 1])) {
          // Nested content (indented) or a lazy paragraph continuation.
          items[items.length - 1]!.push(cur.slice(Math.min(indentOf(cur), base + 2)));
          i++;
        } else break;
      }
      const ListTag = ordered ? "ol" : "ul";
      out.push(
        <ListTag key={key()} start={start} className={cn("my-2 space-y-1 pl-6", ordered ? "list-decimal" : "list-disc")}>
          {items.map((body, j) => {
            const task = /^\[([ xX])\]\s+/.exec(body[0] ?? "");
            if (task) body = [body[0]!.slice(task[0].length), ...body.slice(1)];
            return (
              <li key={j} className={cn("pl-1 [&>p]:my-0", task && "list-none")}>
                {task ? (
                  <input type="checkbox" checked={task[1] !== " "} readOnly disabled className="-ml-5 mr-2 align-middle" />
                ) : null}
                {renderBlocks(body, resolve, `${keyPrefix}${k}-${j}-`)}
              </li>
            );
          })}
        </ListTag>,
      );
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && (para.length === 0 || !startsBlock(lines[i]!, lines[i + 1]))) para.push(lines[i++]!.trim());
    out.push(
      <p key={key()} className="my-2.5 leading-relaxed">
        {renderInline(para.join("\n"), resolve)}
      </p>,
    );
  }
  return out;
}

export function MarkdownView({ text, resolveImage }: { text: string; resolveImage: ResolveUrl }) {
  const blocks = useMemo(() => renderBlocks(text.replace(/\r\n?/g, "\n").split("\n"), resolveImage), [text, resolveImage]);
  return <article className="mx-auto max-w-[760px] px-6 py-5 text-[14px] leading-relaxed">{blocks}</article>;
}
