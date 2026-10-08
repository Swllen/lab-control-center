import type { NextConfig } from "next";

// REST calls are proxied so the session cookie stays first-party.
// WebSockets connect directly to the backend (see lib/api/client.ts -> wsUrl).
const BACKEND_URL = process.env.LCC_BACKEND_URL ?? "http://127.0.0.1:8600";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${BACKEND_URL}/api/:path*` }];
  },
};

export default nextConfig;
