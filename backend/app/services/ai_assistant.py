"""Terminal assistant backed by an OpenAI-compatible chat API (default: Z.ai / GLM, international).

The API key lives only on the backend: ``LCC_AI_API_KEY`` in the environment, or a key saved from the
Settings page into ``data/ai_api_key``. Terminal output is only sent when the user explicitly attaches
it, and obvious secrets are redacted first.
"""

from __future__ import annotations

import json
import os
import re
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any, Literal

import httpx

from app.config import get_settings


class AssistantError(Exception):
    pass


# ---------------------------------------------------------------- key storage


def _key_file() -> Path:
    return get_settings().data_dir / "ai_api_key"


def api_key() -> tuple[str | None, Literal["env", "file", "none"]]:
    if key := get_settings().ai_api_key.strip():
        return key, "env"
    path = _key_file()
    if path.is_file() and (key := path.read_text(encoding="utf-8").strip()):
        return key, "file"
    return None, "none"


def save_api_key(key: str) -> None:
    path = _key_file()
    path.write_text(key.strip(), encoding="utf-8")
    try:
        os.chmod(path, 0o600)
    except OSError:  # Windows: ACLs, best effort
        pass


def delete_api_key() -> None:
    _key_file().unlink(missing_ok=True)


# ---------------------------------------------------------------- endpoint / model (editable in Settings)

ENDPOINT_PRESETS = {
    "international": "https://api.z.ai/api/paas/v4",  # Z.ai
    "china": "https://open.bigmodel.cn/api/paas/v4",  # 智谱开放平台 (bigmodel.cn)
}


def _config_file() -> Path:
    return get_settings().data_dir / "ai_config.json"


def ai_config() -> tuple[str, str, bool]:
    """(base_url, model, thinking): values saved from the Settings page override the env defaults."""
    settings = get_settings()
    base_url, model, thinking = settings.ai_base_url, settings.ai_model, settings.ai_thinking
    try:
        saved = json.loads(_config_file().read_text(encoding="utf-8"))
        base_url = saved.get("base_url") or base_url
        model = saved.get("model") or model
        thinking = bool(saved.get("thinking", thinking))
    except (OSError, ValueError):
        pass
    return base_url, model, thinking


def save_ai_config(base_url: str, model: str, thinking: bool) -> None:
    _config_file().write_text(json.dumps({"base_url": base_url, "model": model, "thinking": thinking}), encoding="utf-8")


# ---------------------------------------------------------------- redaction

_SECRET_PATTERNS = [
    re.compile(r"(?i)\b(sk|pk|rk)-[A-Za-z0-9_\-]{16,}"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}"),
    re.compile(r"\bhf_[A-Za-z0-9]{20,}"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\bxox[abprs]-[A-Za-z0-9\-]{10,}"),
    re.compile(r"(?i)(bearer\s+)[A-Za-z0-9._\-]{16,}"),
    re.compile(r"(?i)((?:password|passwd|secret|token|api[_-]?key)\s*[=:]\s*)\S+"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----"),
]


def redact(text: str) -> str:
    for pattern in _SECRET_PATTERNS:
        text = pattern.sub(lambda m: (m.group(1) if m.lastindex else "") + "[REDACTED]", text)
    return text


# ---------------------------------------------------------------- prompting

SYSTEM_PROMPT = """你是 Lab Server Control Center 里的终端助手，帮助研究人员在 Linux GPU 服务器上完成终端操作。

回答规则：
- 默认用简体中文回答，命令、参数、路径保持英文原样。
- 先给出可以直接使用的命令，放在 ```bash 代码块里，每个代码块只放一条命令或一组紧密相关的命令；再用一两句话解释关键参数。
- 回答要简短。用户在终端里干活，不需要长篇背景介绍。
- 命令要适配下面给出的服务器环境（发行版、GPU、当前登录账户）。
- 对有破坏性或需要 root 的操作（rm -rf、sudo、kill、dd、chmod -R、关机重启等）要明确提示风险；能先“只读查看”的，先给查看命令。
- 不要编造不存在的命令或参数；不确定时直接说明，并给出查看帮助的方法（man / --help）。
- 用户附上终端输出时，根据输出解释原因并给出下一步命令。"""


def environment_block(server: dict[str, Any] | None) -> str:
    if not server:
        return "当前没有选中服务器终端。"
    lines = ["当前终端环境："]
    for label, key in (
        ("服务器", "name"), ("主机名", "hostname"), ("系统", "os"), ("内核", "kernel"), ("登录账户", "user"),
        ("CPU", "cpu"), ("内存", "memory"), ("GPU", "gpus"), ("NVIDIA 驱动", "driver"), ("CUDA", "cuda"),
    ):
        if server.get(key):
            lines.append(f"- {label}: {server[key]}")
    if server.get("admin_account"):
        lines.append(f"- 注意：这是管理员账户（ssh config Host {server['admin_account']}），提醒用户谨慎操作。")
    return "\n".join(lines)


def build_messages(
    history: list[dict[str, str]], server: dict[str, Any] | None, terminal_output: str | None
) -> list[dict[str, str]]:
    settings = get_settings()
    messages = [{"role": "system", "content": SYSTEM_PROMPT + "\n\n" + environment_block(server)}]
    trimmed = history[-settings.ai_max_history_messages :]
    for i, msg in enumerate(trimmed):
        content = msg["content"][: settings.ai_max_message_chars]
        if i == len(trimmed) - 1 and msg["role"] == "user" and terminal_output:
            output = redact(terminal_output[-settings.ai_max_terminal_chars :])
            content = f"{content}\n\n以下是我终端里最近的输出：\n```text\n{output}\n```"
        messages.append({"role": msg["role"], "content": content})
    return messages


# ---------------------------------------------------------------- streaming call


async def stream_chat(
    messages: list[dict[str, str]], *, model: str | None = None, thinking: bool | None = None
) -> AsyncIterator[str]:
    """Stream a reply. ``model`` / ``thinking`` override the saved defaults for this request."""
    key, _ = api_key()
    if not key:
        raise AssistantError("还没有配置 AI API Key：在 Settings 页面填写，或在 backend/.env 中设置 LCC_AI_API_KEY")
    base_url, default_model, default_thinking = ai_config()
    model = model or default_model
    thinking = default_thinking if thinking is None else thinking
    body: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "stream": True,
        "temperature": 0.3,
        "thinking": {"type": "enabled" if thinking else "disabled"},
    }
    url = base_url.rstrip("/") + "/chat/completions"
    timeout = httpx.Timeout(connect=10.0, read=120.0, write=30.0, pool=10.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        async with client.stream(
            "POST", url, json=body, headers={"Authorization": f"Bearer {key}", "Accept-Language": "zh-CN,en"}
        ) as resp:
            if resp.status_code != 200:
                detail = (await resp.aread()).decode(errors="replace")[:500]
                try:
                    err = json.loads(detail).get("error", {})
                    detail = err.get("message") or detail
                except (ValueError, AttributeError):
                    pass
                raise AssistantError(f"AI 接口返回 {resp.status_code}: {detail}")
            async for line in resp.aiter_lines():
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    return
                try:
                    chunk = json.loads(data)
                except ValueError:
                    continue
                for choice in chunk.get("choices") or []:
                    if text := (choice.get("delta") or {}).get("content"):
                        yield text
