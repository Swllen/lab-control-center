"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { authApi, jobsApi, metricsApi, queryKeys, serversApi, terminalsApi, transfersApi } from "@/lib/api";
import type { Server } from "@/lib/types";

export function useMe() {
  return useQuery({ queryKey: queryKeys.me, queryFn: authApi.me, retry: false, staleTime: 5 * 60_000 });
}

export function useServers() {
  return useQuery({ queryKey: queryKeys.servers, queryFn: serversApi.list, staleTime: 30_000 });
}

export function useServerMap(): Map<number, Server> {
  const { data } = useServers();
  return useMemo(() => new Map((data ?? []).map((s) => [s.id, s])), [data]);
}

export function useMetricsSummary() {
  return useQuery({ queryKey: queryKeys.summary, queryFn: metricsApi.summary, refetchInterval: 15_000 });
}

export function useJobs(limit = 50) {
  return useQuery({ queryKey: queryKeys.jobs(limit), queryFn: () => jobsApi.list({ limit }), refetchInterval: 10_000 });
}

export function useTransfers(limit = 50) {
  return useQuery({
    queryKey: queryKeys.transfers(limit),
    queryFn: () => transfersApi.list(limit),
    refetchInterval: 10_000,
  });
}

export function useTerminalAccounts() {
  return useQuery({ queryKey: ["terminal-accounts"], queryFn: terminalsApi.accounts, staleTime: 60_000 });
}
