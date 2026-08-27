# Windows-Portal-Stack (Blueprint v1.2.0)

**Host:** Windows 10/11 · `192.168.178.60` (optional)

```
TS server (Docker) · Genetic Optimizer · Academy (WFO/DSR)
React dashboard (Vite / :3000) · NFS mount Z:\data
```

## Was läuft hier?

- **React-Dashboard** (Vite-Production-Build) auf `:3000`
- **TS-Server** (Fastify/TypeScript):
  - **Genetic Optimizer** — Walk-Forward GA in TypeScript, nutzt die
    Frontend-Fitness-Engines (`src/optimizer/MultiObjectiveFitnessEngine.ts`
    + `CadenceFitnessModule.ts`), DSR >95%-Gate **vor** Shadow,
    Counterfactual Replay
  - **Academy** — WFO/DSR-Registry, Stress-Drills DR-01..05,
    Bootstrap-Validierung, Post-Mortem RAG-Lite (Persistenz in `Z:\data`)
  - **Reverse-Proxy** → Alpha Execution Core (Ubuntu `192.168.178.50:8000`)
    für alle M8-/Marktdaten-/Backtest-Endpoints

## Setup (auf dem Windows-Host)

```powershell
# 1. Repo clonen/kopieren
git clone <repo> C:\Projekt_Alpha

# 2. Setup-Skript (erfordert Admin-Rechte)
cd C:\Projekt_Alpha\stacks\windows
powershell -ExecutionPolicy Bypass -File .\setup_windows.ps1
```

Das Skript:
1. prüft Docker Desktop
2. aktiviert das Windows-Feature **Client for NFS**
3. mountet `Z:` = `192.168.178.50:/srv/alpha/data` (`New-NfsMapping`)
4. startet `docker compose up -d --build`

Danach: **http://localhost:3000**

## Docker-Compose

```yaml
alpha-portal:
  build: { context: ../.., dockerfile: stacks/windows/Dockerfile }
  ports: ["3000:3000"]
  environment:
    ALPHA_CORE_URL: http://192.168.178.50:8000   # Ubuntu-Core per LAN
  volumes:
    - Z:\\data:/data                              # NFS-Mount (DuckDB-Share)
```

> Build-Kontext ist der **Repo-Root**, weil das Dashboard im selben Build
> von Vite kompiliert wird (Stage 1), dann der TS-Server (Stage 2) und
> beides in einem kleinen Node-Image (Stage 3).

## Lokaler Test ohne Docker (any OS)

```bash
# Core (Ubuntu-Sandbox) läuft bereits auf :8000
cd stacks/windows/ts-server
npm install
npm run build
ALPHA_CORE_URL=http://127.0.0.1:8000 PUBLIC_DIR=../../dist ALPHA_DATA_DIR=/tmp/alpha-data node dist/server.js
# → :3000 mit Dashboard + GA + Academy, Proxy → :8000
```

## Endpunkte (TS-Server lokal, Rest via Proxy)

| Route | Host | Zweck |
|---|---|---|
| `GET /api/healthz` | Windows | Portal-Status |
| `POST /api/genetic/run` | Windows | WFO-GA (TS) + DSR-Gate + Replay |
| `POST /api/quant/evolution/run` | Windows | kleiner GA-Run (Academy) |
| `GET /api/academy/strategies` | Windows | Registry |
| `GET /api/academy/strategies/:id/career` | Windows | Career-Book |
| `POST /api/academy/drills/run` | Windows | DR-01..05 |
| `POST /api/quant/validation/bootstrap` | Windows | Bootstrap-CI |
| `POST /api/quant/postmortem/analyze` | Windows | RAG-Lite |
| `POST /api/genetic/deploy-to-orchestrator` | **Core** (Proxy) | Evolved-Strategie deployen |
| alle übrigen `/api/*` | **Core** (Proxy) | M8, Marktdaten, Backtests, Lake, … |
