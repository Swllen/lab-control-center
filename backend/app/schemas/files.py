from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class FileEntry(BaseModel):
    name: str
    path: str
    type: Literal["file", "dir", "symlink", "other"]
    size: int
    mtime: int | None
    mode: str
    owner: str | None
    group: str | None
    link_target: str | None = None
    target_type: Literal["file", "dir", "symlink", "other"] | None = None


class DirListing(BaseModel):
    server_id: int
    path: str
    parent: str | None
    home: str
    entries: list[FileEntry]
    truncated: bool = False


class PathBody(BaseModel):
    path: str = Field(min_length=1, max_length=4096)


class RenameBody(BaseModel):
    path: str = Field(min_length=1, max_length=4096)
    new_path: str = Field(min_length=1, max_length=4096)
    overwrite: bool = False


class DeleteBody(BaseModel):
    paths: list[str] = Field(min_length=1, max_length=500)
    confirm: bool = Field(description="Must be true; the UI asks the user first")


class CopyRequest(BaseModel):
    source_server_id: int
    source_path: str = Field(min_length=1, max_length=4096)
    dest_server_id: int
    dest_dir: str = Field(min_length=1, max_length=4096)
