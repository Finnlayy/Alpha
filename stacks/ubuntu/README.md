# Ubuntu Core-Stack (Blueprint v1.2.0)

**Host:** Ubuntu 24.04 · `192.168.178.50` (Always-on)

```
Ingestion: OmniStream / Glint / CCXT WS
M8 Judge (Noir) · Shadow Execution (Jaune / CCXT Pro)
Redis :6379 AOF · DuckDB / Parquet
Stack: ccxt · httpx · fastapi · uvicorn · pydantic · pyarrow
```

## Option A — Docker (empfohlen für Testbetrieb)

```bash
cd stacks/ubuntu
docker compose up -d --build
# API:      http://192.168.178.50:8000/api/dashboard/init
# m8-ctl:   docker compose exec alpha-core /srv/alpha/bin/m8-ctl states
```

`docker-compose.yml` startet:
- `redis` — Redis 7 mit **AOF** (`appendfsync everysec`), Volume `redis-aof`
- `alpha-core` — FastAPI-Execution-API (`:8000`), Daten in `./data` (NFS-Export-Ziel)

## Option B — Bare-Metal (systemd)

```bash
sudo bash setup_ubuntu.sh /pfad/zum/repo
```

Das Skript installiert: `redis-server`, `nfs-kernel-server`, `python3-venv`,
legt `alpha`-User + `/srv/alpha` an, baut `.venv`, konfiguriert
**Redis-AOF**, **NFS-Export** für den Windows-Host und aktiviert die
systemd-Units `alpha-redis.service` + `alpha-core.service` (inkl. Watchdog).

```bash
journalctl -u alpha-core -f          # Logs
sudo -u alpha /srv/alpha/bin/m8-ctl  # Notfall-CLI
```

## Notfall-CLI (`bin/m8-ctl`)

| Befehl | Wirkung |
|---|---|
| `status` / `states` / `vault` / `autopsies` | Telemetrie (Redis SCAN) |
| `halt BTC/USD 300` | `halt:symbol:{symbol}` (TTL 300s, Blueprint §4) |
| `promote <id>` | Explizite Re-Promotion (QUARANTINED/THROTTLED → ACTIVE) |
| `quarantine <id>` / `retire <id>` | Manuelle State-Transitions |
| `eod` | EOD-Profit-Factor-Abrechnung (3×PF<1 → THROTTLED, 7× → QUARANTINED) |
| `cancel-all [id]` | EMERGENCY: alle offenen Positionen schließen |
| `halt-system [reason]` / `resume` | M-00 State-Machine (EMERGENCY_HALT / SHADOW_ACTIVE) |

## NFS-Export (für Windows `Z:\data`)

```
/srv/alpha/data  192.168.178.60(rw,sync,no_subtree_check,no_root_squash)
```

`no_root_squash` ist bewusst gesetzt: der Windows-Docker-Container bindet
`Z:\data` nach `/data` und schreibt dort als root (Academy-Registry,
DuckDB-Mirror). Im LAN ist dies sicher; im WAN niemals aktivieren.

## Production-Anbindungen ([MOCK-SEAM]-Stellen)

| Modul | Sandbox-Modus | Produktion |
|---|---|---|
| Ingestion | `synthetic` (deterministischer GBM-Feed) | `ALPHA_MARKET_SOURCE=ccxt_ws` + `app/ingestion/OmniStreamIngestor._ccxt_feed_available` |
| Kraken-API | Paper-Store | `app/mcp/KrakenMCPBridge._paper_execute` → ccxt pro |
| Telegram | no-op ohne Token | `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` |
| Vault-L2 | lokaler Parquet-Partition | Rclone-Sync (`/api/lake/sync`) |
| WebAuthn | `webauthn`-Lib + degraded-Fallback | echter Authenticator (Windows Hello / Touch ID) |
