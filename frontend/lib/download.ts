import { filesApi } from "@/lib/api";

/** Start a native browser download that streams straight from the backend. */
export function triggerDownload(serverId: number, path: string): void {
  const a = document.createElement("a");
  a.href = filesApi.downloadUrl(serverId, path);
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
