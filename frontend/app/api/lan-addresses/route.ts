import { networkInterfaces } from "node:os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store", Vary: "Cookie" };
  try {
    const auth = await fetch(`${process.env.LCC_BACKEND_URL ?? "http://127.0.0.1:8600"}/api/auth/me`, {
      headers: { cookie: request.headers.get("cookie") ?? "" },
      cache: "no-store", signal: AbortSignal.timeout(5000),
    });
    if (!auth.ok) return Response.json({ detail: "Not authenticated" }, { status: auth.status === 401 ? 401 : 502, headers });
    const user = await auth.json();
    if (user.role !== "admin") return Response.json({ detail: "Administrator access required" }, { status: 403, headers });
  } catch {
    return Response.json({ detail: "Cannot reach the backend" }, { status: 502, headers });
  }
  const port = Number(process.env.LCC_HTTP_PORT) || 3000;
  const addresses = Object.entries(networkInterfaces()).flatMap(([name, entries]) =>
    (entries ?? []).filter(entry => entry.family === "IPv4" && !entry.internal &&
      /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(entry.address))
      .map(entry => ({ name, url: `http://${entry.address}:${port}`, virtual: /zerotier|tailscale|vpn|vethernet|vmware|virtualbox|docker|wsl/i.test(name) })),
  ).sort((a, b) => Number(a.virtual) - Number(b.virtual));
  return Response.json({ addresses }, { headers });
}
