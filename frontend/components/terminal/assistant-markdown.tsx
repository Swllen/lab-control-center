"use client";

import { Check, Copy, CornerDownLeft, TriangleAlert } from "lucide-react";
import { useState, type ReactNode } from "react";
import { isRisky } from "@/lib/assistant/chat";
import { copyToClipboard, cn } from "@/lib/utils";

type Block = { kind: "code"; lang: string; text: string } | { kind: "text"; text: string };

function splitBlocks(src: string): Block[] {
  const blocks: Block[] = [];
  const re = /```([\w+-]*)[^\n]*\n([\s\S]*?)(```|$)/g;
  let last = 0;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (m.index > last) blocks.push({ kind: "text", text: src.slice(last, m.index) });
    blocks.push({ kind: "code", lang: m[1] || "", text: m[2]!.replace(/\n$/, "") });
    last = re.lastIndex;
  }
  if (last < src.length) blocks.push({ kind: "text", text: src.slice(last) });
  return blocks;
}

/** `code` and **bold** inside a line, rendered as React nodes (never as HTML). */
function inline(text: string, key: string): ReactNode[] {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((p, i) => {
    if (p.startsWith("`") && p.endsWith("`") && p.length > 2) {
      return <code key={`${key}-${i}`} className="rounded bg-track px-1 py-px font-mono text-[12px]">{p.slice(1, -1)}</code>;
    }
    if (p.startsWith("**") && p.endsWith("**") && p.length > 4) return <strong key={`${key}-${i}`}>{p.slice(2, -2)}</strong>;
    return <span key={`${key}-${i}`}>{p}</span>;
  });
}

function TextBlock({ text }: { text: string }) {
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    out.push(
      <Tag key={`l${out.length}`} className={cn("my-1 space-y-0.5 pl-5", list.ordered ? "list-decimal" : "list-disc")}>
        {list.items.map((it, i) => <li key={i}>{inline(it, `li${out.length}-${i}`)}</li>)}
      </Tag>,
    );
    list = null;
  };
  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const ordered = !!numbered;
      if (!list || list.ordered !== ordered) {
        flush();
        list = { ordered, items: [] };
      }
      list.items.push((bullet ?? numbered)![1]!);
      return;
    }
    flush();
    if (!line.trim()) return;
    const heading = /^#{1,4}\s+(.*)$/.exec(line);
    out.push(
      heading ? (
        <p key={`p${i}`} className="mt-1 font-semibold">{inline(heading[1]!, `h${i}`)}</p>
      ) : (
        <p key={`p${i}`}>{inline(line, `p${i}`)}</p>
      ),
    );
  });
  flush();
  return <div className="space-y-1.5">{out}</div>;
}

function CodeBlock({ lang, text, onInsert }: { lang: string; text: string; onInsert: ((t: string) => void) | null }) {
  const [copied, setCopied] = useState(false);
  const shell = !lang || /^(bash|sh|shell|zsh|console)$/i.test(lang);
  const risky = shell && isRisky(text);
  // "$ cmd" prompts are a common habit in answers; strip them so the command can run as-is.
  const command = text.replace(/^\s*\$\s+/gm, "");
  return (
    <div className={cn("overflow-hidden rounded-xl ring-1", risky ? "ring-warning/50" : "ring-white/[0.06]")}>
      <div className="flex items-center gap-2 bg-[#141d2e] px-2.5 py-1 text-[11px] text-slate-400">
        <span className="font-mono">{lang || "bash"}</span>
        {risky ? (
          <span className="flex items-center gap-1 text-amber-300" title="This command can change or delete things. Read it before running.">
            <TriangleAlert className="size-3" /> 谨慎执行
          </span>
        ) : null}
        <span className="ml-auto flex gap-0.5">
          {shell && onInsert ? (
            <button
              type="button"
              onClick={() => onInsert(command)}
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-slate-300 hover:bg-white/10 hover:text-white"
              title="填入当前终端的输入行（不会自动执行）"
            >
              <CornerDownLeft className="size-3" /> 插入
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void copyToClipboard(command).then((ok) => ok && (setCopied(true), setTimeout(() => setCopied(false), 1200)))}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-slate-300 hover:bg-white/10 hover:text-white"
          >
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />} {copied ? "已复制" : "复制"}
          </button>
        </span>
      </div>
      <pre className="overflow-x-auto bg-[#0f1624] px-3 py-2.5 font-mono text-[12px] leading-relaxed text-slate-100">{text}</pre>
    </div>
  );
}

export function AssistantMarkdown({ text, onInsert }: { text: string; onInsert: ((t: string) => void) | null }) {
  return (
    <div className="space-y-2.5 text-[13px] leading-relaxed">
      {splitBlocks(text).map((b, i) =>
        b.kind === "code" ? <CodeBlock key={i} lang={b.lang} text={b.text} onInsert={onInsert} /> : <TextBlock key={i} text={b.text} />,
      )}
    </div>
  );
}
