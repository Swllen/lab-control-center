/** Minimal POSIX path helpers for remote paths (the browser has no `path` module). */
function normalize(p: string): string {
  const abs = p.startsWith("/");
  const out: string[] = [];
  for (const part of p.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return (abs ? "/" : "") + out.join("/") || (abs ? "/" : ".");
}

const posixPath = {
  join: (...parts: string[]) => normalize(parts.filter(Boolean).join("/")),
  dirname: (p: string) => {
    const n = normalize(p);
    const i = n.lastIndexOf("/");
    return i <= 0 ? (n.startsWith("/") ? "/" : ".") : n.slice(0, i);
  },
  basename: (p: string) => normalize(p).split("/").pop() ?? "",
};

export default posixPath;
