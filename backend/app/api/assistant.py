"""Terminal assistant API.

``POST /api/assistant/chat`` streams NDJSON lines: ``{"delta": "..."}`` ... ``{"done": true}``
(or ``{"error": "..."}``). The browser calls the backend directly (like uploads) so the stream is not
buffered by the Next.js dev proxy.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any, Literal

import httpx
from fastapi import APIRouter, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.api.deps import get_server_or_404
from app.core.deps import AdminUser, CurrentUser, DbSession, OperatorUser
from app.services.ai_assistant import (
    ENDPOINT_PRESETS,
    AssistantError,
    ai_config,
    api_key,
    save_ai_config,
    build_messages,
    delete_api_key,
    save_api_key,
    stream_chat,
)
from app.services.metrics_collector import MetricsHub
from app.services.ssh_config import alternate_accounts

router = APIRouter(prefix="/api/assistant", tags=["assistant"])


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=50_000)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=100)
    server_id: int | None = None
    account: str | None = Field(default=None, max_length=255)
    terminal_output: str | None = Field(default=None, max_length=200_000)
    # Per-request overrides chosen in the assistant panel (defaults come from Settings).
    model: str | None = Field(default=None, max_length=100, pattern=r"^[A-Za-z0-9._:\-/]+$")
    thinking: bool | None = None


class AssistantStatus(BaseModel):
    configured: bool
    key_source: Literal["env", "file", "none"]
    model: str
    base_url: str
    thinking: bool
    presets: dict[str, str]


class ConfigBody(BaseModel):
    base_url: str = Field(min_length=8, max_length=300, pattern=r"^https://[^\s]+$")
    model: str = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9._:\-/]+$")
    thinking: bool = True


class TestResult(BaseModel):
    ok: bool
    reply: str | None = None
    error: str | None = None


class KeyBody(BaseModel):
    api_key: str = Field(min_length=8, max_length=512)


@router.get("/status", response_model=AssistantStatus)
async def assistant_status(_: CurrentUser) -> AssistantStatus:
    key, source = api_key()
    base_url, model, thinking = ai_config()
    return AssistantStatus(
        configured=bool(key), key_source=source, model=model, base_url=base_url, thinking=thinking, presets=ENDPOINT_PRESETS
    )


@router.put("/config", response_model=AssistantStatus)
async def set_config(body: ConfigBody, user: AdminUser) -> AssistantStatus:
    save_ai_config(body.base_url.rstrip("/"), body.model, body.thinking)
    return await assistant_status(user)


@router.post("/test", response_model=TestResult)
async def test_assistant(_: AdminUser) -> TestResult:
    """One tiny request to check the key, endpoint and model together."""
    reply = ""
    try:
        async for delta in stream_chat([{"role": "user", "content": "只回复两个字：可用"}]):
            reply += delta
    except AssistantError as exc:
        return TestResult(ok=False, error=str(exc))
    except httpx.HTTPError as exc:
        return TestResult(ok=False, error=f"无法连接 AI 接口：{exc.__class__.__name__} {exc}")
    return TestResult(ok=True, reply=reply.strip()[:200])


@router.put("/key", status_code=status.HTTP_204_NO_CONTENT)
async def set_key(body: KeyBody, _: AdminUser) -> None:
    """Store the key on the control-center host. It is never returned by any endpoint."""
    save_api_key(body.api_key)


@router.delete("/key", status_code=status.HTTP_204_NO_CONTENT)
async def remove_key(_: AdminUser) -> None:
    delete_api_key()


async def _server_context(request: Request, db: DbSession, server_id: int | None, account: str | None) -> dict[str, Any] | None:
    if server_id is None:
        return None
    server = await get_server_or_404(server_id, db)
    ctx: dict[str, Any] = {"name": server.name, "user": server.username}
    if account:
        alt = next((h for h in alternate_accounts(server) if h.alias == account), None)
        if alt:
            ctx["user"] = alt.user or account
            ctx["admin_account"] = account
    hub: MetricsHub = request.app.state.hub
    runtime = hub.get(server.id)
    if runtime and runtime.static:
        s = runtime.static
        ctx.update(hostname=s.hostname, os=s.os_name, kernel=s.kernel, driver=s.gpu_driver, cuda=s.cuda_version,
                   cpu=f"{s.cpu_model} ({s.cpu_cores} 核 / {s.cpu_threads} 线程)", memory=f"{s.mem_total / 1024**3:.0f} GB")
        if s.gpus:
            ctx["gpus"] = f"{len(s.gpus)} × {s.gpus[0].name}"
    return ctx


@router.post("/chat")
async def chat(body: ChatRequest, request: Request, _: OperatorUser, db: DbSession) -> StreamingResponse:
    server = await _server_context(request, db, body.server_id, body.account)
    messages = build_messages([m.model_dump() for m in body.messages], server, body.terminal_output)

    async def events() -> AsyncIterator[bytes]:
        try:
            async for delta in stream_chat(messages, model=body.model, thinking=body.thinking):
                yield (json.dumps({"delta": delta}, ensure_ascii=False) + "\n").encode()
            yield b'{"done": true}\n'
        except AssistantError as exc:
            yield (json.dumps({"error": str(exc)}, ensure_ascii=False) + "\n").encode()
        except httpx.HTTPError as exc:
            yield (json.dumps({"error": f"无法连接 AI 接口：{exc.__class__.__name__} {exc}"}, ensure_ascii=False) + "\n").encode()

    return StreamingResponse(events(), media_type="application/x-ndjson", headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})
