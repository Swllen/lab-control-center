"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowUp, Brain, ChevronDown, PanelRight, Paperclip, PictureInPicture2, Sparkles, Square, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";
import {
  AI_MODELS,
  assistantApi,
  loadHistory,
  loadPrefs,
  saveHistory,
  savePrefs,
  streamChat,
  type AssistantPrefs,
  type ChatMessage,
} from "@/lib/assistant/chat";
import { RESIZE_HANDLES, useFloatingFrame } from "@/lib/hooks/use-floating-frame";
import { getTerminal } from "@/lib/terminal/registry";
import type { PaneState } from "@/lib/terminal/workspace-store";
import { cn } from "@/lib/utils";
import { AssistantMarkdown } from "./assistant-markdown";

const ATTACH_LINES = 80;

const SUGGESTIONS = [
  "查看哪个进程占用了 GPU 显存",
  "找出当前目录下最占空间的文件夹",
  "后台运行训练脚本并把日志写到文件",
  "解压 tar.gz 到指定目录",
  "查看某个端口被哪个进程占用",
];

export type AssistantMode = "docked" | "floating";

export function AssistantPanel({
  pane,
  serverName,
  mode,
  onModeChange,
  onClose,
}: {
  pane: PaneState | null;
  serverName: string | null;
  mode: AssistantMode;
  onModeChange: (mode: AssistantMode) => void;
  onClose: () => void;
}) {
  const floating = mode === "floating";
  const { frame, startDrag, startResize } = useFloatingFrame("lcc.assistant.frame.v1", floating);
  const toggleMode = () => onModeChange(floating ? "docked" : "floating");
  const { data: status } = useQuery({ queryKey: ["assistant", "status"], queryFn: assistantApi.status, staleTime: 30_000 });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [attach, setAttach] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);

  const [prefs, setPrefsState] = useState<AssistantPrefs>({ model: null, thinking: null });
  const setPrefs = (next: AssistantPrefs) => {
    setPrefsState(next);
    savePrefs(next);
  };
  const model = prefs.model ?? status?.model ?? "glm-4.5-air";
  const thinking = prefs.thinking ?? status?.thinking ?? true;
  const modelChoices = AI_MODELS.some((m) => m.id === model) ? AI_MODELS : [{ id: model, note: "Settings 默认" }, ...AI_MODELS];

  useEffect(() => {
    setMessages(loadHistory());
    setPrefsState(loadPrefs());
  }, []);
  useEffect(() => {
    if (!streaming) saveHistory(messages);
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages, streaming]);

  const insert = pane
    ? (text: string) => {
        const term = getTerminal(pane.id);
        if (!term) return toast.error("当前终端还没有连接");
        term.insert(text);
        toast("已填入终端，确认后按回车执行");
      }
    : null;

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || streaming) return;
    const output = attach && pane ? getTerminal(pane.id)?.recentOutput(ATTACH_LINES) ?? null : null;
    const history = [...messages.filter((m) => !m.error), { role: "user" as const, content: question, attached: !!output }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setAttach(false);
    setStreaming(true);
    const controller = new AbortController();
    abort.current = controller;
    let reply = "";
    try {
      await streamChat(
        {
          messages: history.map(({ role, content }) => ({ role, content })),
          server_id: pane?.serverId ?? null,
          account: pane?.account ?? null,
          terminal_output: output,
          model,
          thinking,
        },
        (delta) => {
          reply += delta;
          setMessages([...history, { role: "assistant", content: reply }]);
        },
        controller.signal,
      );
      if (!reply) setMessages([...history, { role: "assistant", content: "（没有返回内容）", error: true }]);
    } catch (err) {
      if (controller.signal.aborted) {
        setMessages([...history, { role: "assistant", content: reply || "（已停止）" }]);
      } else {
        setMessages([...history, { role: "assistant", content: err instanceof Error ? err.message : "请求失败", error: true }]);
      }
    } finally {
      setStreaming(false);
      abort.current = null;
      textarea.current?.focus();
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(input);
    }
  };

  const context = pane && serverName ? `${serverName}${pane.account ? ` · ${pane.username ?? pane.account}` : ""}` : null;

  return (
    <aside
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl",
        floating
          ? // Near-opaque: it floats over the dark terminal, so a see-through glass reads as grey.
            "fixed z-40 border border-glass-border bg-[rgb(255_255_255/0.96)] shadow-pop backdrop-blur-2xl animate-fade-in dark:bg-[rgb(22_31_47/0.96)]"
          : "glass w-[380px] shrink-0 3xl:w-[440px]",
        floating && !frame && "invisible",
      )}
      style={floating && frame ? { left: frame.x, top: frame.y, width: frame.w, height: frame.h } : undefined}
      aria-label="终端助手"
    >
      <header
        className={cn("flex items-center gap-2 border-b border-line px-4 py-3", floating && "cursor-move touch-none select-none")}
        onPointerDown={floating ? startDrag : undefined}
        onDoubleClick={(e) => {
          if (!(e.target as HTMLElement).closest("button")) toggleMode();
        }}
        title={floating ? "拖动移动 · 双击停靠到右侧" : "双击变成浮窗"}
      >
        <Sparkles className="size-4 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold leading-tight">终端助手</p>
          <p className="truncate text-[11.5px] text-muted">{context ?? "未选中终端"}</p>
        </div>
        <button
          type="button"
          title="清空对话"
          aria-label="清空对话"
          disabled={streaming || messages.length === 0}
          onClick={() => setMessages([])}
          className="grid size-7 place-items-center rounded-lg text-muted hover:bg-tile hover:text-fg disabled:opacity-40"
        >
          <Trash2 className="size-3.5" />
        </button>
        <button
          type="button"
          title={floating ? "停靠到右侧" : "变成浮窗"}
          aria-label={floating ? "停靠到右侧" : "变成浮窗"}
          onClick={toggleMode}
          className="grid size-7 place-items-center rounded-lg text-muted hover:bg-tile hover:text-fg"
        >
          {floating ? <PanelRight className="size-3.5" /> : <PictureInPicture2 className="size-3.5" />}
        </button>
        <button type="button" title="关闭" aria-label="关闭助手" onClick={onClose} className="grid size-7 place-items-center rounded-lg text-muted hover:bg-tile hover:text-fg">
          <X className="size-4" />
        </button>
      </header>

      <div className="flex items-center gap-2 border-b border-line px-4 py-2">
        <label className="relative flex min-w-0 flex-1 items-center">
          <span className="sr-only">模型</span>
          <select
            value={model}
            onChange={(e) => setPrefs({ ...prefs, model: e.target.value })}
            disabled={streaming}
            className="h-8 w-full appearance-none truncate rounded-lg bg-track py-0 pl-2.5 pr-7 font-mono text-[12px] outline-none transition hover:bg-tile-hover focus:ring-2 focus:ring-primary/30"
            title="本次对话使用的模型"
          >
            {modelChoices.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id} · {m.note}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 size-3.5 text-muted" />
        </label>
        <button
          type="button"
          role="switch"
          aria-checked={thinking}
          disabled={streaming}
          onClick={() => setPrefs({ ...prefs, thinking: !thinking })}
          title={thinking ? "深度思考已开启：命令更准确，首字稍慢" : "深度思考已关闭：回答更快"}
          className={cn(
            "flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium transition",
            thinking ? "bg-primary-soft text-primary" : "bg-track text-muted hover:text-fg",
          )}
        >
          <Brain className="size-3.5" /> 思考{thinking ? "开" : "关"}
        </button>
      </div>

      <div ref={scroller} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {status && !status.configured ? (
          <div className="rounded-2xl bg-warning-soft px-4 py-3 text-[12.5px] leading-relaxed">
            还没有配置 AI API Key。请到 <Link href="/settings" className="font-medium text-primary underline-offset-2 hover:underline">Settings</Link> 填写智谱 API Key 并选择接口地区。
          </div>
        ) : null}
        {messages.length === 0 ? (
          <div className="pt-2">
            <p className="text-[13px] text-muted">想在终端里做什么？直接问，例如：</p>
            <div className="mt-3 flex flex-col gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  disabled={!status?.configured}
                  className="tile rounded-xl px-3 py-2 text-left text-[12.5px] transition hover:bg-tile-hover disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
            <p className="mt-4 text-[11.5px] leading-relaxed text-subtle">
              回答里的命令可以一键“插入”到当前终端，不会自动执行。默认只发送你的问题；点 <Paperclip className="inline size-3" /> 才会附上终端最近 {ATTACH_LINES} 行输出（密钥类内容会被遮盖）。
            </p>
          </div>
        ) : (
          messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[88%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-[13px] leading-relaxed text-white">
                  <p className="whitespace-pre-wrap break-words">{m.content}</p>
                  {m.attached ? <p className="mt-1 flex items-center gap-1 text-[11px] text-white/75"><Paperclip className="size-3" /> 已附上终端输出</p> : null}
                </div>
              </div>
            ) : (
              <div key={i} className={cn("min-w-0", m.error && "rounded-xl bg-danger-soft px-3 py-2 text-danger")}>
                {m.content ? (
                  m.error ? <p className="text-[12.5px]">{m.content}</p> : <AssistantMarkdown text={m.content} onInsert={insert} />
                ) : (
                  <span className="inline-flex gap-1 py-2">
                    {[0, 1, 2].map((d) => (
                      <span key={d} className="size-1.5 animate-bounce rounded-full bg-subtle" style={{ animationDelay: `${d * 120}ms` }} />
                    ))}
                  </span>
                )}
              </div>
            ),
          )
        )}
      </div>

      <div className="border-t border-line p-3">
        <div className="rounded-2xl bg-glass-strong ring-1 ring-line focus-within:ring-primary/40">
          <textarea
            ref={textarea}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            placeholder={status?.configured ? "问点什么… (Enter 发送，Shift+Enter 换行)" : "先在 Settings 配置 API Key"}
            disabled={!status?.configured}
            className="block max-h-40 min-h-[52px] w-full resize-none bg-transparent px-3.5 pt-2.5 text-[13px] outline-none placeholder:text-subtle"
          />
          <div className="flex items-center gap-2 px-2 pb-2">
            <button
              type="button"
              onClick={() => setAttach((a) => !a)}
              disabled={!pane}
              title={pane ? `附上当前终端最近 ${ATTACH_LINES} 行输出` : "先选中一个终端"}
              className={cn(
                "flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] transition disabled:opacity-40",
                attach ? "bg-primary-soft text-primary" : "text-muted hover:bg-tile hover:text-fg",
              )}
            >
              <Paperclip className="size-3.5" /> {attach ? "将附上终端输出" : "附上终端输出"}
            </button>
            {streaming ? (
              <button type="button" onClick={() => abort.current?.abort()} className="ml-auto grid size-8 place-items-center rounded-xl bg-fg text-bg" aria-label="停止">
                <Square className="size-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void send(input)}
                disabled={!input.trim() || !status?.configured}
                className="ml-auto grid size-8 place-items-center rounded-xl bg-primary text-white transition disabled:opacity-40"
                aria-label="发送"
              >
                <ArrowUp className="size-4" />
              </button>
            )}
          </div>
        </div>
      </div>
      {floating ? (
        <>
          {RESIZE_HANDLES.map((handle) => (
            <div
              key={handle.label}
              role="separator"
              aria-label={`拖动${handle.label}调整大小`}
              onPointerDown={(e) => startResize(e, handle.edges)}
              className={cn("absolute z-10 touch-none", handle.className)}
            />
          ))}
          {/* Visible grip so the resize affordance is discoverable. */}
          <svg viewBox="0 0 12 12" className="pointer-events-none absolute bottom-1 right-1 z-10 size-3.5 text-subtle" aria-hidden>
            <path d="M11 2 2 11M11 6 6 11M11 10 10 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </>
      ) : null}
    </aside>
  );
}
