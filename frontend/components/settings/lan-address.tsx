"use client";

import { useQuery } from "@tanstack/react-query";
import { Copy, Network } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CardHeader, GlassCard } from "@/components/ui/card";
import { api } from "@/lib/api/client";
import { copyToClipboard } from "@/lib/utils";

export function LanAddress() {
  const query = useQuery({
    queryKey: ["lan-addresses"],
    queryFn: () => api<{ addresses: { name: string; url: string; virtual: boolean }[] }>("/api/lan-addresses"),
    staleTime: 60_000, refetchInterval: 60_000, retry: false,
  });
  const addresses = query.data?.addresses ?? [];
  return <GlassCard className="pb-5 xl:col-span-2">
    <CardHeader icon={<Network />} title="局域网访问" />
    <div className="space-y-3 px-6 text-sm">
      <p className="text-muted">同一局域网的其他电脑，直接在浏览器打开下面的地址即可，使用同一个网页账号登录。</p>
      {query.isLoading ? <p className="text-muted">正在获取地址…</p> : null}
      {query.error ? <p role="alert" className="text-danger">{query.error.message}</p> : null}
      {addresses.map(address => <div key={address.url} className="tile flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3">
        <div><p className="select-all font-mono">{address.url}</p>{addresses.length > 1 ? <p className="mt-1 text-xs text-muted">{address.name}{address.virtual ? " · 虚拟网络" : ""}</p> : null}</div>
        <Button size="sm" onClick={async () => {
          if (await copyToClipboard(address.url)) toast.success("地址已复制");
          else toast.error("请选中地址手动复制");
        }}><Copy /> 复制地址</Button>
      </div>)}
      {query.data && !addresses.length ? <p className="text-muted">未发现局域网 IPv4 地址，请检查网线或 Wi-Fi 连接。</p> : null}
      <p className="text-xs leading-relaxed text-muted">如果打不开：在主机上使用 start-lan.cmd 启动，并允许防火墙中的 3000、8600 端口。显示地址不代表其他电脑已经可以连接。IP 可能随网络变化。</p>
    </div>
  </GlassCard>;
}
