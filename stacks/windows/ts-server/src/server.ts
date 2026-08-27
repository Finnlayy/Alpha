/**
 * =========================================================
 * Datei:      stacks/windows/ts-server/src/server.ts
 * Zweck:      Projekt:Alpha Windows-Portal (Blueprint v1.2.0)
 *             — React-Dashboard (Vite-Build, :3000)
 *             — Genetic Optimizer (WFO/DSR, TS)
 *             — Academy (Registry, Drills, Bootstrap, RAG)
 *             — Reverse-Proxy → Alpha Execution Core (Ubuntu)
 * Host:       Windows 192.168.178.60 (Docker) · NFS Z:\data → /data
 * =========================================================
 */
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { CoreProxy } from "./proxy.js";
import { GeneticOptimizer, type Candle, type GeneticConfig } from "./optimizer/GeneticOptimizer.js";
import { AcademyRegistry, ACADEMY_DATA_PATH } from "./academy/AcademyRegistry.js";

const PORT = Number(process.env.PORT || 3000);
const CORE_URL = process.env.ALPHA_CORE_URL || "http://192.168.178.50:8000";

const app = Fastify({ logger: { level: process.env.LOG_LEVEL || "info" } });

await app.register(cors, { origin: true });

// ------------------------------------------------------------- static UI
const publicDir = process.env.PUBLIC_DIR || join(process.cwd(), "public");
if (existsSync(publicDir)) {
  await app.register(fastifyStatic, { root: publicDir, index: ["index.html"] });
} else {
  app.log.warn(`PUBLIC_DIR ${publicDir} fehlt — Dashboard nicht verfügbar.`);
}

// ----------------------------------------------------------------- engines
const proxy = new CoreProxy(CORE_URL);
const ga = new GeneticOptimizer();
const academy = new AcademyRegistry(ACADEMY_DATA_PATH);

// Lokal behandelte Routen (Windows-Host laut Blueprint); alles andere → Core.
const LOCAL_ROUTES = new Set([
  "/api/genetic/run",
  "/api/quant/evolution/run",
  "/api/academy/strategies",
  "/api/academy/drills/run",
  "/api/quant/validation/bootstrap",
  "/api/quant/postmortem/analyze",
]);

app.get("/api/healthz", async () => ({
  ok: true,
  host: "windows-portal",
  blueprint: "v1.2.0",
  coreUrl: CORE_URL,
  publicDir: existsSync(publicDir),
  academyEntries: academy.list().length,
  uptimeSec: Math.round(process.uptime()),
}));

// ----------------------------------------------------------------- candles
async function fetchCandles(pair: string, interval: number, count: number): Promise<Candle[]> {
  const factor = Math.max(1, interval);
  const raw = await proxy.getJson<{ candles: Candle[] }>(
    `/api/backtest/ohlc?pair=${encodeURIComponent(pair)}&interval=${factor}&count=${count}`
  );
  if (!raw || !Array.isArray(raw.candles)) {
    throw new Error(
      `Core-API nicht erreichbar unter ${CORE_URL} (OHLC ${pair}) — ` +
      "Ubuntu-Core starten oder ALPHA_CORE_URL prüfen."
    );
  }
  return raw.candles as Candle[];
}

// ------------------------------------------------------------------- GA
async function runGa(body: Record<string, unknown>): Promise<unknown> {
  const cfg: GeneticConfig = {
    populationSize: Number(body.populationSize || 30),
    maxGenerations: Number(body.maxGenerations || 50),
    survivorsCount: Number(body.survivorsCount || 3),
    mutationRate: Number(body.mutationRate || 0.18),
    crossoverRate: Number(body.crossoverRate || 0.8),
    walkForwardSplitPercent: Number(body.walkForwardSplitPercent || 70),
    assetPair: String(body.assetPair || "BTC/USD"),
    interval: Number(body.interval || 15),
    candleCount: Number(body.candleCount || 500),
    initialBalance: Number(body.initialBalance || 10000),
    feePercent: Number(body.feePercent || 0.26),
    slippagePercent: Number(body.slippagePercent || 0.05),
    baselineStrategyId: body.baselineStrategyId ? String(body.baselineStrategyId) : undefined,
    baselineStrategyName: body.baselineStrategyName ? String(body.baselineStrategyName) : undefined,
  };
  app.log.info(`GA-Run (Windows-TS): ${cfg.assetPair} ${cfg.interval}m Pop=${cfg.populationSize} Gens=${cfg.maxGenerations}`);
  const candles = await fetchCandles(cfg.assetPair, cfg.interval, cfg.candleCount);
  const started = Date.now();
  const result = ga.run(cfg, candles);
  app.log.info(`GA-Run fertig in ${Date.now() - started}ms — best fitness=${result.bestIndividual.fitness} DSR=${result.bestIndividual.dsr} Gate=${result.shadowGate.verdict}`);
  academy.updateFromEvolution(
    cfg.baselineStrategyId || "",
    result.bestIndividual.overallReturn,
    result.bestIndividual.sharpeRatio,
    result.bestIndividual.dsr
  );
  return result;
}

app.post("/api/genetic/run", async (req, reply) => {
  try {
    return await runGa((req.body ?? {}) as Record<string, unknown>);
  } catch (err) {
    reply.code(502);
    return { error: err instanceof Error ? err.message : String(err) };
  }
});

app.post("/api/quant/evolution/run", async (req, reply) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    const result = (await runGa({
      populationSize: body.populationSize ?? 12,
      maxGenerations: body.maxGenerations ?? 10,
      survivorsCount: 3,
      mutationRate: 0.25,
      crossoverRate: 0.7,
      walkForwardSplitPercent: 70,
      assetPair: body.assetPair ?? "BTC/USD",
      interval: body.interval ?? 15,
      candleCount: body.candleCount ?? 500,
      initialBalance: 10000,
      feePercent: 0.26,
      slippagePercent: 0.05,
    })) as {
      bestIndividual: { fitness: number; overallReturn: number; dsr: number; genes: Record<string, unknown> };
      totalGenerationsCompleted: number;
      shadowGate: { verdict: string };
    };
    return {
      bestFitness: result.bestIndividual.fitness,
      bestReturn: result.bestIndividual.overallReturn,
      bestDsr: result.bestIndividual.dsr,
      generations: result.totalGenerationsCompleted,
      shadowGate: result.shadowGate,
      bestGenes: result.bestIndividual.genes,
      engine: "windows-ts-ga",
    };
  } catch (err) {
    reply.code(502);
    return { error: err instanceof Error ? err.message : String(err) };
  }
});

// ----------------------------------------------------------------- academy
app.get("/api/academy/strategies", async () => academy.list());

app.get("/api/academy/strategies/:id/career", async (req, reply) => {
  const { id } = req.params as { id: string };
  const entry = academy.get(id);
  if (!entry) {
    reply.code(404);
    return { error: `Strategie '${id}' nicht in der Academy-Registry.` };
  }
  return { id, registry: entry, genomes: [], trackRecord: { closedTrades: 0, winRate: 0, netPnlUsd: 0 } };
});

app.post("/api/academy/drills/run", async (req, reply) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const strategyId = String(body.strategyId || "demo-strategy-uuid");
  const symbol = String(body.symbol || "BTC/USD");
  if (!academy.get(strategyId)) {
    academy.seed([{ id: strategyId, name: strategyId, symbol, intervalMin: 15 }]);
  }
  return academy.runDrills(strategyId, symbol);
});

app.post("/api/quant/validation/bootstrap", async (req) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const trials = Number(body.trials || 500);
  const strategyId = body.strategyId ? String(body.strategyId) : undefined;
  // Returns aus Core (Trades) beziehen, falls Strategie angegeben
  let returns: number[] = [];
  if (strategyId) {
    const trades = await proxy.getJson<Array<{ net_pnl_usd: number }>>(
      `/api/m8/autopsies?limit=500`
    );
    if (trades) {
      returns = trades.map((t) => t.net_pnl_usd ?? 0);
    }
  }
  return academy.bootstrapValidation(returns, trials);
});

app.post("/api/quant/postmortem/analyze", async (req) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  return academy.postmortemAnalyze(String(body.failureQuery || ""));
});

// ------------------------------------------------------------------ proxy
app.all("/api/*", async (req, reply) => {
  const url = req.raw.url || "/";
  if (LOCAL_ROUTES.has(url)) {
    return reply.send({ error: "Use dedicated handler." }).code(404);
  }
  let body: Buffer | undefined;
  if (req.method !== "GET" && req.method !== "HEAD") {
    const chunks: Buffer[] = [];
    for await (const chunk of req.raw) chunks.push(chunk as Buffer);
    body = Buffer.concat(chunks);
  }
  const res = await proxy.forward(req, body);
  if (!res) {
    reply.code(502);
    return {
      error: `Alpha Core nicht erreichbar unter ${CORE_URL} — ` +
        "Ubuntu-Core (192.168.178.50:8000) starten oder ALPHA_CORE_URL setzen.",
    };
  }
  for (const [k, v] of Object.entries(res.headers)) {
    reply.header(k, v);
  }
  return reply.code(res.status).send(res.body);
});

// HTML-Fallback auf das Dashboard (SPA)
app.setNotFoundHandler((req, reply) => {
  if (req.url.startsWith("/api/")) {
    return reply.code(404).send({ error: `Unknown API route: ${req.url}` });
  }
  return reply.type("text/html").send(
    existsSync(join(publicDir, "index.html"))
      ? readFileSync(join(publicDir, "index.html"), "utf-8")
      : "Projekt:Alpha TS-Server (Dashboard-Build fehlt — npm run build im Repo-Root)"
  );
});

try {
  await app.listen({ port: PORT, host: "0.0.0.0" });
  app.log.info(`Alpha Windows-Portal auf :${PORT} (Core: ${CORE_URL})`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
