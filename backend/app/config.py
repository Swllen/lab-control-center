"""Application settings, loaded from environment variables (prefix ``LCC_``) or ``.env``."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="LCC_", env_file=".env", extra="ignore")

    # --- Core -------------------------------------------------------------
    database_url: str = f"sqlite+aiosqlite:///{(BACKEND_ROOT / 'data' / 'lcc.db').as_posix()}"
    secret_key: str = Field(
        default="",
        description="Signs session cookies. Generated and persisted to data/secret_key if empty.",
    )
    session_max_age_s: int = 60 * 60 * 24 * 7
    cookie_secure: bool = False
    allowed_origins: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]

    # --- Bootstrap admin ---------------------------------------------------
    admin_username: str = "admin"
    admin_password: str = Field(
        default="",
        description="Initial admin password. Random (and written to data/) if empty on first run.",
    )

    # --- SSH ----------------------------------------------------------------
    ssh_key_dirs: list[str] = ["~/.ssh"]
    ssh_known_hosts: Literal["auto", "ignore"] | str = "auto"
    ssh_connect_timeout_s: float = 10.0
    ssh_keepalive_interval_s: int = 15

    # --- Terminals ----------------------------------------------------------
    # Sessions without any attached browser are closed after this long (refresh-safe grace period).
    terminal_idle_timeout_s: int = 15 * 60

    # --- Jobs / scheduler -----------------------------------------------------
    scheduler_interval_s: float = 5.0
    # A GPU counts as free when below both thresholds (protects other users' processes).
    gpu_free_max_mem_frac: float = 0.10
    gpu_free_max_util: float = 15.0
    max_sweep_jobs: int = 1000

    # --- AI terminal assistant (OpenAI-compatible; default Z.ai international) ----
    ai_api_key: str = ""  # or save it from the Settings page (data/ai_api_key)
    ai_base_url: str = "https://api.z.ai/api/paas/v4"
    ai_model: str = "glm-4.5-air"
    ai_thinking: bool = True  # more accurate commands; ~2 s slower first token
    ai_max_history_messages: int = 20
    ai_max_message_chars: int = 8_000
    ai_max_terminal_chars: int = 12_000

    # --- Metrics ------------------------------------------------------------
    metrics_interval_s: float = 2.0
    metrics_history_len: int = 150  # 5 minutes at 2 s

    # --- Demo ---------------------------------------------------------------
    demo_mode: bool = Field(
        default=True,
        description="Seed simulated servers/jobs/transfers on an empty database.",
    )

    @property
    def data_dir(self) -> Path:
        path = BACKEND_ROOT / "data"
        path.mkdir(parents=True, exist_ok=True)
        return path


@lru_cache
def get_settings() -> Settings:
    return Settings()
