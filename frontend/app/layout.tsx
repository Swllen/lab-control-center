import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { ScenicBackground } from "@/components/layout/scenic-background";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Lab Server Control Center", template: "%s · Lab Control Center" },
  description: "Monitor and manage AI research servers",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#e8eef5" },
    { media: "(prefers-color-scheme: dark)", color: "#0b111c" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ScenicBackground />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
