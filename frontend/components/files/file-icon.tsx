import {
  File,
  FileArchive,
  FileCode,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileTerminal,
  FileText,
  Folder,
  FolderSymlink,
  Link2,
  type LucideIcon,
} from "lucide-react";
import type { FileEntry } from "@/lib/types";
import { cn } from "@/lib/utils";

const BY_EXT: [RegExp, LucideIcon, string][] = [
  [/\.(py|ipynb|js|ts|tsx|jsx|c|cc|cpp|h|hpp|cu|rs|go|java|lua|rb)$/i, FileCode, "text-violet"],
  [/\.(sh|bash|zsh|slurm|sbatch)$/i, FileTerminal, "text-success"],
  [/\.(json|ya?ml|toml|ini|cfg|conf)$/i, FileJson, "text-warning"],
  [/\.(csv|tsv|parquet|arrow|feather|xlsx?)$/i, FileSpreadsheet, "text-success"],
  [/\.(png|jpe?g|gif|webp|svg|bmp|tiff?)$/i, FileImage, "text-primary"],
  [/\.(tar|gz|tgz|zip|xz|zst|bz2|7z|rar)$/i, FileArchive, "text-warning"],
  [/\.(txt|md|log|out|err|rst)$/i, FileText, "text-muted"],
];

export function isDirLike(e: FileEntry): boolean {
  return e.type === "dir" || (e.type === "symlink" && e.target_type === "dir");
}

export function FileIcon({ entry, className }: { entry: FileEntry; className?: string }) {
  let Icon: LucideIcon = File;
  let color = "text-subtle";
  if (entry.type === "dir") {
    Icon = Folder;
    color = "text-primary";
  } else if (entry.type === "symlink") {
    Icon = entry.target_type === "dir" ? FolderSymlink : Link2;
    color = entry.target_type === "dir" ? "text-primary" : "text-muted";
  } else {
    const hit = BY_EXT.find(([re]) => re.test(entry.name));
    if (hit) [, Icon, color] = hit;
  }
  return <Icon className={cn("size-[17px] shrink-0", color, entry.type === "dir" && "fill-primary/15", className)} strokeWidth={1.7} />;
}
