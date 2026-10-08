export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function describeDetail(detail: unknown, fallback: string): string {
  if (typeof detail === "string") return detail;
  // FastAPI validation errors: [{loc, msg, ...}]
  if (Array.isArray(detail)) {
    return detail
      .map((d: { loc?: unknown[]; msg?: string }) => {
        const field = Array.isArray(d.loc) ? d.loc.filter((p) => p !== "body").join(".") : "";
        return field ? `${field}: ${d.msg}` : d.msg;
      })
      .join("; ");
  }
  return fallback;
}

type Json = Record<string, unknown> | unknown[];

export async function api<T>(
  path: string,
  options: { method?: string; body?: Json; signal?: AbortSignal } = {},
): Promise<T> {
  const res = await fetch(path, {
    method: options.method ?? "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: "same-origin",
    signal: options.signal,
  });
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = (data as { detail?: unknown } | null)?.detail;
    throw new ApiError(res.status, describeDetail(detail, `${res.status} ${res.statusText}`), detail);
  }
  return data as T;
}

/**
 * Direct backend URL (same host as the page, backend port). Used for large streaming uploads and
 * downloads so they bypass the Next.js dev proxy. Same-site, so the session cookie is sent.
 */
export function backendUrl(path: string): string {
  const port = process.env.NEXT_PUBLIC_LCC_WS_PORT ?? "8600";
  return `${window.location.protocol}//${window.location.hostname}:${port}${path}`;
}

/** WebSocket URL on the backend. The host matches the page so the session cookie is sent. */
export function wsUrl(path: string): string {
  const port = process.env.NEXT_PUBLIC_LCC_WS_PORT ?? "8600";
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.hostname}:${port}${path}`;
}
