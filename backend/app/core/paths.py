"""Path validation helpers.

* ``resolve_key_path`` - private keys must live inside the configured key directories on the
  control-center host, so the API cannot be abused to read arbitrary local files.
* ``normalize_remote_path`` - canonicalizes POSIX paths for SFTP operations (Phase 3) and
  rejects NUL bytes / relative escapes.
"""

from __future__ import annotations

import posixpath
from pathlib import Path

from app.config import get_settings


class PathError(ValueError):
    pass


def resolve_key_path(raw: str) -> Path:
    if "\x00" in raw:
        raise PathError("Invalid key path")
    candidate = Path(raw).expanduser().resolve()
    allowed = [Path(d).expanduser().resolve() for d in get_settings().ssh_key_dirs]
    if not any(candidate == d or d in candidate.parents for d in allowed):
        dirs = ", ".join(get_settings().ssh_key_dirs)
        raise PathError(f"Key path must be inside one of: {dirs}")
    if not candidate.is_file():
        raise PathError(f"Key file not found: {raw}")
    return candidate


def normalize_remote_path(path: str, *, base: str = "/") -> str:
    """Return an absolute, normalized POSIX path. ``~`` is left for the SFTP layer to expand."""
    if "\x00" in path:
        raise PathError("Invalid path")
    path = path.strip() or base
    if path == "~" or path.startswith("~/"):
        return path if path == "~" else "~/" + posixpath.normpath(path[2:]).lstrip("/")
    if not path.startswith("/"):
        path = posixpath.join(base, path)
    normalized = posixpath.normpath(path)
    # normpath keeps a leading '//' per POSIX; collapse it.
    return "/" + normalized.lstrip("/")
