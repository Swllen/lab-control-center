"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, CircleX, KeyRound, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CardHeader, GlassCard } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { api } from "@/lib/api/client";
import { AI_MODELS, assistantApi } from "@/lib/assistant/chat";
import { cn } from "@/lib/utils";


const REGION_LABEL: Record<string, string> = { international: "国际版 api.z.ai", china: "国内版 open.bigmodel.cn" };

export function AiSettings({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const { data: status } = useQuery({ queryKey: ["assistant", "status"], queryFn: assistantApi.status });
  const [key, setKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [thinking, setThinking] = useState(true);
  const [test, setTest] = useState<{ ok: boolean; reply?: string | null; error?: string | null } | null>(null);

  useEffect(() => {
    if (status) {
      setBaseUrl(status.base_url);
      setModel(status.model);
      setThinking(status.thinking);
    }
  }, [status]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["assistant"] });
  const save = useMutation({
    mutationFn: async () => {
      if (key.trim()) await assistantApi.setKey(key.trim());
      await api("/api/assistant/config", { method: "PUT", body: { base_url: baseUrl.trim(), model: model.trim(), thinking } });
    },
    onSuccess: () => {
      setKey("");
      setTest(null);
      void refresh();
      toast.success("AI 设置已保存");
    },
    onError: (e) => toast.error(e.message),
  });
  const runTest = useMutation({
    mutationFn: () => api<{ ok: boolean; reply: string | null; error: string | null }>("/api/assistant/test", { method: "POST" }),
    onSuccess: setTest,
    onError: (e) => setTest({ ok: false, error: e.message }),
  });

  return (
    <GlassCard className="pb-5 xl:col-span-2">
      <CardHeader icon={<Sparkles />} title="AI 终端助手" />
      <div className="grid grid-cols-1 gap-x-6 gap-y-4 px-6 lg:grid-cols-2">
        <Field
          label="API Key"
          htmlFor="ai-key"
          hint={
            status?.configured
              ? status.key_source === "env"
                ? "已通过环境变量 LCC_AI_API_KEY 配置（这里填写的不会覆盖它）"
                : "已保存在控制中心本机，不会再显示出来。填写新的会替换它。"
              : "保存在运行控制中心的这台电脑上，只有后端使用，网页拿不到。"
          }
        >
          <div className="flex gap-2">
            <Input
              id="ai-key"
              type="password"
              autoComplete="off"
              placeholder={status?.configured ? "•••••••• 已配置" : "粘贴智谱 API Key"}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              disabled={!isAdmin}
            />
            {status?.key_source === "file" ? (
              <Button
                variant="ghost"
                disabled={!isAdmin}
                onClick={() =>
                  assistantApi.removeKey().then(
                    () => {
                      void refresh();
                      toast("已删除 API Key");
                    },
                    (e: Error) => toast.error(e.message),
                  )
                }
              >
                删除
              </Button>
            ) : null}
          </div>
        </Field>

        <Field label="模型" htmlFor="ai-model" hint="默认 glm-4.5-air，适合命令问答">
          <Input id="ai-model" list="ai-models" value={model} onChange={(e) => setModel(e.target.value)} className="font-mono" disabled={!isAdmin} />
          <datalist id="ai-models">
            {AI_MODELS.map((m) => <option key={m.id} value={m.id}>{m.note}</option>)}
          </datalist>
        </Field>

        <div className="flex flex-col gap-1.5 lg:col-span-2">
          <span className="text-[12.5px] font-medium text-muted">接口地区</span>
          <div className="flex flex-wrap gap-2">
            {Object.entries(status?.presets ?? {}).map(([id, url]) => (
              <button
                key={id}
                type="button"
                disabled={!isAdmin}
                onClick={() => setBaseUrl(url)}
                className={cn("tile rounded-xl px-3.5 py-2 text-left text-[13px] transition hover:bg-tile-hover", baseUrl === url && "ring-2 ring-primary")}
              >
                <span className="font-medium">{REGION_LABEL[id] ?? id}</span>
                <span className="block font-mono text-[11px] text-subtle">{url}</span>
              </button>
            ))}
          </div>
          <p className="text-[12px] text-subtle">key 要和地区对应：bigmodel.cn 申请的 key 用国内版，z.ai 申请的 key 用国际版。</p>
        </div>

        <label className="flex items-center gap-2.5 text-[13px] lg:col-span-2">
          <input type="checkbox" checked={thinking} disabled={!isAdmin} onChange={(e) => setThinking(e.target.checked)} className="size-4 accent-[var(--primary)]" />
          <span>深度思考 <span className="text-muted">— 命令更准确，首字慢约 2 秒，会多消耗一些 token</span></span>
        </label>

        {test ? (
          <div
            className={cn(
              "flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-[12.5px] lg:col-span-2",
              test.ok ? "bg-success-soft text-success" : "bg-danger-soft text-danger",
            )}
          >
            {test.ok ? <CircleCheck className="mt-0.5 size-4 shrink-0" /> : <CircleX className="mt-0.5 size-4 shrink-0" />}
            <span className="break-words">{test.ok ? `连接成功，模型回复：“${test.reply}”` : test.error}</span>
          </div>
        ) : null}

        <div className="flex gap-2.5 lg:col-span-2">
          <Button variant="primary" disabled={!isAdmin} loading={save.isPending} onClick={() => save.mutate()}>
            <KeyRound /> 保存
          </Button>
          <Button disabled={!isAdmin || !status?.configured} loading={runTest.isPending} onClick={() => runTest.mutate()}>
            测试连接
          </Button>
          {!isAdmin ? <span className="self-center text-[12px] text-subtle">只有管理员可以修改</span> : null}
        </div>
      </div>
    </GlassCard>
  );
}
