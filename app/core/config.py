"""
=========================================================
Datei:      app/core/config.py
Zweck:      Zentraler Konfigurations-Hub (Hot-Reload fähig)
System:     Manas: Ciel Core Matrix — Projekt:Alpha
Knoten:     Jaune (Carrera-Engine) / Core
=========================================================
"""
from __future__ import annotations

import os
import threading
from dataclasses import dataclass, field
from typing import Any, Dict, Optional


def _env(name: str, default: str) -> str:
    return os.environ.get(name, default)


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def _env_int(name: str, default: int) -> int:
    try:
        return int(float(os.environ.get(name, default)))
    except (TypeError, ValueError):
        return default


@dataclass
class AlphaConfig:
    """Runtime configuration. Mutated in-place by SettingsEnvManager on hot-reload."""

    # --- Identity / environment -------------------------------------------------
    system_name: str = "Manas: Ciel Core Matrix (M8 Execution & Risk Architecture)"
    project_name: str = "Projekt:Alpha"
    spec_version: str = "1.2.0"          # Frozen blueprint prose
    skeleton_version: str = "1.6.4"      # Generated scaffold
    host_label: str = "core"             # 'core' (Ubuntu 192.168.178.50) | 'windows' (192.168.178.60)

    # --- Redis ------------------------------------------------------------------
    redis_url: str = "redis://127.0.0.1:6379/0"
    allow_fakeredis: bool = True         # In-memory fallback when no Redis binary exists

    # --- Data lake ----------------------------------------------------------------
    data_dir: str = "data"
    duckdb_path: str = ""                # default: {data_dir}/alpha.duckdb
    parquet_dir: str = ""                # default: {data_dir}/lake
    duckdb_memory_limit: str = "2GB"
    duckdb_threads: int = 4

    # --- M8 state machine (Blueprint v1.2.0 frozen) --------------------------------
    base_budget_usd: float = 50.0
    throttle_budget_pct: float = 0.5     # -> THROTTLED at <= 50% base
    activate_budget_pct: float = 0.5     # v1.2.0: THROTTLED -> ACTIVE at > 50% base
    # skeleton 1.6.4 delta (opt-in): promotion at >= 80%
    use_v164_promotion: bool = False
    v164_promotion_pct: float = 0.8
    low_pf_throttle_days: int = 3        # 3 consecutive EOD PF < 1.0
    low_pf_quarantine_days: int = 7      # 7 consecutive EOD PF < 1.0
    retired_shadow_weeks: int = 4        # RETIRED after 4 weeks shadow w/o GA recalibration
    # v1.2.0: every net win -> 100% USD vault sweep, budget resets to base
    vault_sweep_enabled: bool = True
    # frozen prose v1.2.0 autopsy order: STOP_LOSS before BAD (CLEAN_LOSS first)
    autopsy_order: str = "v1.2.0"        # 'v1.2.0' (frozen) | 'v1.6.4' (delta)

    # --- Risk / sizing -------------------------------------------------------------
    max_allowed_leverage: float = 10.0
    spot_max_leverage: float = 1.0       # spot long-only 1.0x
    maintenance_margin_rate: float = 0.005
    clearance_fee_rate: float = 0.0075
    risk_fraction_per_trade: float = 0.20
    maker_fee_rate: float = 0.0002
    taker_fee_rate: float = 0.0005

    # --- TradeChurnGuard (v1.6.4-only guards) --------------------------------------
    churn_min_holding_seconds: int = 180
    churn_cooldown_seconds: int = 300
    churn_max_daily_trades: int = 12
    churn_fee_hurdle_multiple: float = 2.5

    # --- Ingestion / market ---------------------------------------------------------
    market_symbols: tuple = ("BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD")
    market_source: str = "synthetic"     # 'synthetic' | 'ccxt_ws'
    tick_interval_seconds: float = 1.5
    candle_interval_sec: int = 60        # live aggregation candle (1m)
    seed_candle_count: int = 7560   # 5.25 Tage 1m-Historie → 504 Candles @15m (WFO-tauglich)

    # --- Paper portfolio (baseline per Kraken Runner design reference) --------------
    paper_baseline_usd: float = 190412.50
    paper_seeds: tuple = (
        "USD:50000", "BTC:1.5", "ETH:10", "SOL:100", "XRP:5000"
    )
    paper_symbol_prices: tuple = (
        "BTC/USD:97000", "ETH/USD:3400", "SOL/USD:180", "XRP/USD:2.20"
    )

    # --- Security ---------------------------------------------------------------------
    rp_id: str = "localhost"
    rp_origin: str = "http://localhost:3000"
    settings_token_ttl_seconds: int = 3600
    webauthn_degraded_fallback: bool = True

    # --- Integrations -------------------------------------------------------------------
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""
    mcp_tool_count: int = 149

    # --- GA / Academy ---------------------------------------------------------------------
    ga_min_trades_absolute: int = 30
    ga_min_trades_target: int = 80
    ga_max_allowed_rules: int = 6
    ga_fitness_threshold: float = 0.35
    ga_dsr_gate: float = 0.95
    ga_cadence_min: float = 3.0
    ga_cadence_max: float = 6.0

    # --- Runtime ---------------------------------------------------------------------
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    sse_interval_seconds: float = 2.0
    log_level: str = "INFO"

    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False, compare=False)

    @property
    def resolved_duckdb_path(self) -> str:
        return self.duckdb_path or os.path.join(self.data_dir, "alpha.duckdb")

    @property
    def resolved_parquet_dir(self) -> str:
        return self.parquet_dir or os.path.join(self.data_dir, "lake")

    def snapshot(self) -> Dict[str, Any]:
        return {k: v for k, v in self.__dict__.items() if not k.startswith("_")}

    def reload_from_env(self) -> None:
        """Re-read all env-backed values (used by SettingsEnvManager hot-reload)."""
        with self._lock:
            self.data_dir = _env("ALPHA_DATA_DIR", self.data_dir)
            self.redis_url = _env("ALPHA_REDIS_URL", self.redis_url)
            self.allow_fakeredis = _env_bool("ALPHA_ALLOW_FAKE_REDIS", self.allow_fakeredis)
            self.base_budget_usd = _env_float("ALPHA_BASE_BUDGET_USD", self.base_budget_usd)
            self.use_v164_promotion = _env_bool("ALPHA_USE_V164_PROMOTION", self.use_v164_promotion)
            self.vault_sweep_enabled = _env_bool("ALPHA_VAULT_SWEEP", self.vault_sweep_enabled)
            self.autopsy_order = _env("ALPHA_AUTOPSY_ORDER", self.autopsy_order)
            self.max_allowed_leverage = _env_float("ALPHA_MAX_LEVERAGE", self.max_allowed_leverage)
            self.risk_fraction_per_trade = _env_float("ALPHA_RISK_FRACTION", self.risk_fraction_per_trade)
            self.maker_fee_rate = _env_float("ALPHA_MAKER_FEE", self.maker_fee_rate)
            self.taker_fee_rate = _env_float("ALPHA_TAKER_FEE", self.taker_fee_rate)
            self.churn_cooldown_seconds = _env_int("ALPHA_CHURN_COOLDOWN_S", self.churn_cooldown_seconds)
            self.churn_max_daily_trades = _env_int("ALPHA_CHURN_MAX_DAILY", self.churn_max_daily_trades)
            self.churn_fee_hurdle_multiple = _env_float("ALPHA_FEE_HURDLE_MULT", self.churn_fee_hurdle_multiple)
            self.market_source = _env("ALPHA_MARKET_SOURCE", self.market_source)
            self.log_level = _env("ALPHA_LOG_LEVEL", self.log_level)
            self.telegram_bot_token = _env("TELEGRAM_BOT_TOKEN", self.telegram_bot_token)
            self.telegram_chat_id = _env("TELEGRAM_CHAT_ID", self.telegram_chat_id)


def load_config() -> AlphaConfig:
    cfg = AlphaConfig()
    cfg.reload_from_env()
    return cfg
