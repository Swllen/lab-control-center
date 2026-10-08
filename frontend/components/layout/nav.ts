import {
  ArrowLeftRight,
  Cpu,
  FileText,
  Folder,
  House,
  ListChecks,
  Server,
  Settings,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  title: string;
  subtitle: string;
  shortcut: string; // "g <key>" chord
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: House, shortcut: "d",
    title: "Lab Server Control Center", subtitle: "Monitor and manage your AI research servers" },
  { href: "/servers", label: "Servers", icon: Server, shortcut: "s",
    title: "Servers", subtitle: "Connections, credentials and host configuration" },
  { href: "/terminals", label: "Terminals", icon: SquareTerminal, shortcut: "t",
    title: "Terminals", subtitle: "Multiple SSH sessions side by side" },
  { href: "/files", label: "Files", icon: Folder, shortcut: "f",
    title: "Files", subtitle: "Browse and move data across servers" },
  { href: "/jobs", label: "Jobs", icon: ListChecks, shortcut: "j",
    title: "Jobs", subtitle: "Experiment queue and parameter sweeps" },
  { href: "/transfers", label: "Transfers", icon: ArrowLeftRight, shortcut: "r",
    title: "Transfers", subtitle: "Uploads, downloads and server-to-server copies" },
  { href: "/hardware", label: "Hardware", icon: Cpu, shortcut: "h",
    title: "Hardware", subtitle: "Detailed CPU, memory, GPU, disk and network telemetry" },
  { href: "/logs", label: "Logs", icon: FileText, shortcut: "l",
    title: "Logs", subtitle: "Control-center and job activity" },
  { href: "/settings", label: "Settings", icon: Settings, shortcut: ",",
    title: "Settings", subtitle: "Preferences and account" },
];

export function navForPath(pathname: string): NavItem {
  return NAV_ITEMS.find((n) => pathname === n.href || pathname.startsWith(`${n.href}/`)) ?? NAV_ITEMS[0]!;
}
