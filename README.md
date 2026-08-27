# Projekt:Alpha

**Manas: Ciel Core Matrix** — M8 Execution & Risk Architecture.
Kompletter Build des Blueprints **v1.2.0 (Final/Frozen)** auf Skeleton **v1.6.4**.

| | |
|---|---|
| **Blueprint Spec** | [v1.2.0 Final](docs/BLUEPRINT-v1.2.0.md) — frozen production spec |
| **Skeleton** | v1.6.4 — 23-File-Scaffold (`setup_alpha.py`) |
| **Autonomy** | Level 4 — High Operational Autonomy |
| **Stacks** | [Ubuntu Core](stacks/ubuntu) (`192.168.178.50`, always-on) · [Windows Portal](stacks/windows) (`192.168.178.60`, optional) |

## Was hier gebaut ist (Blueprint → Umsetzung)

| Blueprint-Feature | Umsetzung |
|---|---|
| M8 State Engine (ACTIVE→THROTTLED→QUARANTINED→RETIRED) | `app/execution/M8StateEngine.py` — atomare Redis-Lua-Scripts (idempotent via `SISMEMBER/SADD`), Local-Fallback, **RETIRED-Pfad** (4 Wochen Shadow ohne GA-Rekalibrierung) |
| Vault & Profit Sweep (v1.2.0: 100% auf jeden Net Win) | `app/execution/VaultEngine.py` + gefrorenes `vault_ledger`-SQL in DuckDB, `strategy_budgets`-Write-Through |
| TradeAutopsy (5 Zonen, R-Multiples, Slippage) | `app/execution/AutopsyProcessor.py` — `pnl_r`, `mfe_r`, `capture_ratio`, **frozen v1.2.0-Zonen-Order** (STOP_LOSS vor BAD; 1.6.4-Delta opt-in) |
| Fast Path (~300 B JSON) | Redis `signals:proposed` / `signals:verdict`, `halt:symbol:{sym}` (TTL 300s), `strategies:wake_up` Pub/Sub → idempotente `TradeAutopsyEvent` → React (SSE) |
| EOD Profit-Factor-Engine („still missing“ → umgesetzt) | `app/execution/EodProfitFactorEngine.py` — 00:05-UTC-Cron + `m8-ctl eod`; 3×PF<1 → THROTTLED, 7×PF<1 → QUARANTINED; Trade-freie Tage zählen NICHT |
| Ingestion (OmniStream/Glint/CCXT WS) | `app/ingestion/OmniStreamIngestor.py` — deterministischer Synthetic-Feed (Sandbox) + **[MOCK-SEAM]** für echten CCXT-WS |
| M8 Judge (Noir) 8 Reject-Gates + Kelly | `app/execution/JudgeEngine.py` — Vol/Spread/Beta/DD/ADV/Sentiment/Hurst/CircuitBreaker + Half-Kelly Vol-Targeting |
| Shadow Execution (Jaune) | `app/execution/PaperExecutionEngine.py` — Fills, MFE/MAE-Tracking, Liquidation (Budget→$0), Fee-Abrechnung, Autopsy-Handoff |
| Leverage/Fee/ChurnGuard/TransientBuffer | `app/execution/*` — Spot 1.0x long-only, Perp max 10x, 180s Hold · 300s Cooldown · 12/Tag · 2.5× Fee Hurdle, 10s-Grace-Buffer |
| Genetic Optimizer & Academy (WFO/DSR) | **zweimal**: Python-GA im Core (`app/optimizer/GeneticOptimizer.py`) **und** TS-GA im Windows-Portal (`stacks/windows/ts-server`) mit DSR>95%-Gate **vor** Shadow, Counterfactual Replay, Frontend-Fitness-Engines wiederverwendet |
| React Dashboard (Vite / :3000) | `src/` — alle ~55 Endpunkte des Frontend-Vertrags implementiert; neu: **StrategyCard** + **MfeMaeScatter** („still missing“ → umgesetzt) in der M8-Sektion |
| Passkey-gated Settings & Mutations | `app/security/PasskeyAuthEngine.py` (py_webauthn + degraded-Fallback), `SettingsEnvManager.py` (CRUD + Hot-Reload) |
| MCP Bridge (~149 Tools) + Telegram | `app/mcp/KrakenMCPBridge.py` (Passkey-Intercept für mutative Tools) · `app/telegram/TelegramBotEngine.py` (no-op ohne Token) |
| Notfall-CLI | `bin/m8-ctl` — status/states/vault/autopsies/halt/promote/quarantine/retire/eod/cancel-all/halt-system |

### [MOCK-SEAM]-Stellen (klar markiert, ersetzbar)

Alles, was im Sandbox ohne Netzwerk/Exchange läuft, ist mit `[MOCK]`/`[MOCK-SEAM]`
kommentiert: CCXT-WS-Feed, Kraken-Live-API, Telegram, Rclone/Google-Drive-Sync,
FinBERT (Lexikon-Proxy), RL-Fast-Path (deterministischer Proxy), Firebase-Config.

## Quick Start (Local, ein Host)

```bash
# 1. Python-Core (API :8000, Paper-Trading-Loop läuft sofort)
pip install -r requirements.txt
python3 -m uvicorn app.server.main:app --host 0.0.0.0 --port 8000

# 2. Dashboard (Vite :3000, Proxy /api → :8000)
npm install
npm run dev          # → http://localhost:3000

# 3. Tests (43 Tests: Phase-1..4-Acceptance)
pytest tests/ -v
```

## Die zwei Stacks (Blueprint §1)

### Ubuntu Core — `192.168.178.50` (always-on)
Docker (`stacks/ubuntu/docker-compose.yml`: Redis-AOF + alpha-core) **oder**
Bare-Metal (`sudo bash stacks/ubuntu/setup_ubuntu.sh`) mit systemd-Units,
Redis-AOF und **NFS-Export** von `/srv/alpha/data`.
→ Details: [stacks/ubuntu/README.md](stacks/ubuntu/README.md)

### Windows Portal — `192.168.178.60` (optional)
Docker (`stacks/windows/docker-compose.yml`): TS-Server (Fastify) mit
**Genetic Optimizer** + **Academy** + React-Dashboard auf `:3000`,
Reverse-Proxy zum Ubuntu-Core, **NFS-Mount `Z:\data`**.
→ Details: [stacks/windows/README.md](stacks/windows/README.md)

## Repository Structure

```
project-alpha/
├── docs/BLUEPRINT-v1.2.0.md   # Master spec (frozen)
├── setup_alpha.py              # Lokales 23-File-Scaffold
├── app/
│   ├── core/                   # config, redis, duckdb_store, event_bus, telemetry
│   ├── execution/              # M8StateEngine, VaultEngine, AutopsyProcessor,
│   │                           # JudgeEngine, PaperExecutionEngine, EodProfitFactorEngine,
│   │                           # Leverage/Fee/ChurnGuard/TransientBuffer, StrategyInterpreter
│   ├── ingestion/              # OmniStreamIngestor (synthetic + ccxt_ws-[MOCK-SEAM])
│   ├── backtest/               # BacktestEngine (Replay, Fees, AI-Analysis)
│   ├── optimizer/              # GeneticOptimizer (WFO/DSR), AcademyRegistry
│   ├── quant/                  # RegimeEngine (DFA/Hurst, Ampel, Lead-Lag, Sentiment)
│   ├── security/               # PasskeyAuthEngine, SettingsEnvManager
│   ├── mcp/                    # KrakenMCPBridge (~149 Tools, Passkey-Intercept)
│   ├── telegram/               # TelegramBotEngine
│   └── server/                 # FastAPI-App + Quant-Routen (SSE, M8-Admin, Lake, GA)
├── bin/m8-ctl                  # Notfall-Steuerungstool
├── tests/                      # 43 Tests inkl. Phase-1..4-Acceptance
├── stacks/
│   ├── ubuntu/                 # Dockerfile, compose, systemd, setup_ubuntu.sh, README
│   └── windows/                # Dockerfile, compose, setup_windows.ps1, README, ts-server/
├── src/                        # React-Dashboard (Vite :3000)
│   ├── components/             # Panels + StrategyCard + MfeMaeScatter (neu)
│   ├── lib/                    # api, symbolNormalizer, firebase
│   └── optimizer/              # MultiObjectiveFitnessEngine, CadenceFitnessModule (TS)
└── data/                       # DuckDB + Parquet-Lake (git-ignoriert)
```

## Version Notes

- **Blueprint v1.2.0** = frozen prose spec (Source of Truth)
- **Skeleton v1.6.4** = generiertes Code-Scaffold mit zusätzlichen Guards
- Deltas (HWM-Recovery, THROTTLED→ACTIVE-Schwelle, Autopsy-Order) sind
  dokumentiert und **opt-in** via `ALPHA_USE_V164_PROMOTION` / `ALPHA_AUTOPSY_ORDER`
  → siehe [Delta-Tabelle](docs/BLUEPRINT-v1.2.0.md#v120--v164-deltas)
