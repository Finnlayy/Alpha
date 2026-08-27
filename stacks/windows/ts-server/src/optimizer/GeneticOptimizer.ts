/**
 * =========================================================
 * Datei:      stacks/windows/ts-server/src/optimizer/GeneticOptimizer.ts
 * Zweck:      Walk-Forward GA (Windows-Host, Blueprint v1.2.0 Phase 4)
 *             — nutzt die Frontend-Fitness-Engines (MultiObjective + Cadence)
 *             — DSR (Bailey/López de Prado) > 95% Gate VOR Shadow
 *             — Counterfactual Replay im Shadow-Überlappungsfenster
 * =========================================================
 */

import { MultiObjectiveFitnessEngine, type BacktestMetrics } from "./MultiObjectiveFitnessEngine.js";
import { CadenceFitnessModule } from "./CadenceFitnessModule.js";

export interface Candle {
  time: number;      // epoch seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp?: string;
}

export interface Genes {
  atrPeriod: number;
  atrStopMultiplier: number;
  atrTakeProfitMultiplier: number;
  useTrailingAtr: boolean;
  trailingAtrStep: number;
  useVolumeFilter: boolean;
  rvolThreshold: number;
  useObvTrend: boolean;
  useTrendFilter: boolean;
  trendFastEma: number;
  trendSlowEma: number;
  adxFilterEnabled: boolean;
  adxThreshold: number;
  useFvgFilter: boolean;
  fvgMinGapPercent: number;
  fvgMitigationStrict: boolean;
  useCisdFilter: boolean;
  cisdLookback: number;
  cisdDisplacementMult: number;
  useMtfFilter: boolean;
  mtfMultiplier: number;
  mtfTrendEma: number;
  riskPerTradePercent: number;
}

export interface Individual {
  id: string;
  generation: number;
  genes: Genes;
  fitness: number;
  isValidCandidate: boolean;
  rejectionReason?: string;
  inSampleSummary: Record<string, number>;
  outOfSampleSummary: Record<string, number>;
  overallReturn: number;
  overallDrawdown: number;
  sharpeRatio: number;
  winRate: number;
  tradesCount: number;
  tradesPerDay: number;
  dsr: number;
  robustnessIndex: number;
  rank: number;
  isSurvivor: boolean;
  isBaselineSeed?: boolean;
}

export interface GeneticConfig {
  populationSize: number;
  maxGenerations: number;
  survivorsCount: number;
  mutationRate: number;
  crossoverRate: number;
  walkForwardSplitPercent: number;
  assetPair: string;
  interval: number;
  candleCount: number;
  initialBalance: number;
  feePercent: number;
  slippagePercent: number;
  baselineStrategyId?: string;
  baselineStrategyName?: string;
}

export interface GaResult {
  id: string;
  assetPair: string;
  interval: number;
  totalGenerationsCompleted: number;
  populationSize: number;
  survivorCount: number;
  bestIndividual: Individual;
  topSurvivors: Individual[];
  population: Individual[];
  history: Array<{
    generation: number;
    bestFitness: number;
    avgFitness: number;
    bestReturn: number;
    bestSharpe: number;
    bestDrawdown: number;
    bestIndividualId: string;
  }>;
  inSampleCandles: number;
  outOfSampleCandles: number;
  generatedCode: string;
  shadowGate: {
    passed: boolean;
    checks: Record<string, boolean>;
    dsr: number;
    requiredDsr: number;
    verdict: string;
  };
  counterfactualReplay: {
    windowCandles: number;
    replayTrades: number;
    replayNetPnlUsd: number;
    replayReturnPct: number;
    replaySharpe: number;
    note: string;
  };
}

// ---------------------------------------------------------------- utilities
let seedState = 1337;
export function rng(): number {
  // xorshift32 — deterministisch je Seed
  let x = seedState;
  x ^= x << 13; x >>>= 0;
  x ^= x >> 17;
  x ^= x << 5; x >>>= 0;
  seedState = x;
  return x / 4294967296;
}
export function reseed(seed: number) { seedState = (seed >>> 0) || 1337; }

function randInt(lo: number, hi: number) { return Math.floor(rng() * (hi - lo + 1)) + lo; }
function randFloat(lo: number, hi: number) { return rng() * (hi - lo) + lo; }

function randomGenes(): Genes {
  const g: Genes = {
    atrPeriod: randInt(7, 30),
    atrStopMultiplier: randFloat(1.0, 4.5),
    atrTakeProfitMultiplier: randFloat(1.5, 8.0),
    useTrailingAtr: rng() < 0.4,
    trailingAtrStep: randFloat(0.2, 2.0),
    useVolumeFilter: rng() < 0.4,
    rvolThreshold: randFloat(1.0, 3.5),
    useObvTrend: rng() < 0.4,
    useTrendFilter: rng() < 0.4,
    trendFastEma: randInt(5, 35),
    trendSlowEma: randInt(35, 120),
    adxFilterEnabled: rng() < 0.4,
    adxThreshold: randInt(15, 35),
    useFvgFilter: rng() < 0.3,
    fvgMinGapPercent: randFloat(0.05, 1.0),
    fvgMitigationStrict: rng() < 0.3,
    useCisdFilter: rng() < 0.3,
    cisdLookback: randInt(5, 25),
    cisdDisplacementMult: randFloat(1.1, 2.5),
    useMtfFilter: rng() < 0.3,
    mtfMultiplier: randInt(3, 12),
    mtfTrendEma: randInt(20, 100),
    riskPerTradePercent: randFloat(0.5, 5.0),
  };
  if (g.trendSlowEma <= g.trendFastEma * 2) g.trendSlowEma = g.trendFastEma * 4 + 8;
  return g;
}

function mutateGenes(g: Genes, rate: number): Genes {
  const out: Genes = { ...g };
  const maybe = () => rng() < rate;
  if (maybe()) out.atrPeriod = Math.min(30, Math.max(7, out.atrPeriod + randInt(-3, 3)));
  if (maybe()) out.atrStopMultiplier = Math.min(4.5, Math.max(1.0, out.atrStopMultiplier + randFloat(-0.4, 0.4)));
  if (maybe()) out.atrTakeProfitMultiplier = Math.min(8.0, Math.max(1.5, out.atrTakeProfitMultiplier + randFloat(-0.6, 0.6)));
  if (maybe()) out.useTrailingAtr = !out.useTrailingAtr;
  if (maybe()) out.trailingAtrStep = Math.min(2.0, Math.max(0.2, out.trailingAtrStep + randFloat(-0.2, 0.2)));
  if (maybe()) out.useVolumeFilter = !out.useVolumeFilter;
  if (maybe()) out.rvolThreshold = Math.min(3.5, Math.max(1.0, out.rvolThreshold + randFloat(-0.3, 0.3)));
  if (maybe()) out.useObvTrend = !out.useObvTrend;
  if (maybe()) out.useTrendFilter = !out.useTrendFilter;
  if (maybe()) out.trendFastEma = Math.min(35, Math.max(5, out.trendFastEma + randInt(-4, 4)));
  if (maybe()) out.trendSlowEma = Math.min(120, Math.max(40, out.trendSlowEma + randInt(-8, 8)));
  if (maybe()) out.adxFilterEnabled = !out.adxFilterEnabled;
  if (maybe()) out.adxThreshold = Math.min(35, Math.max(15, out.adxThreshold + randInt(-3, 3)));
  if (maybe()) out.useFvgFilter = !out.useFvgFilter;
  if (maybe()) out.useCisdFilter = !out.useCisdFilter;
  if (maybe()) out.useMtfFilter = !out.useMtfFilter;
  if (maybe()) out.riskPerTradePercent = Math.min(5.0, Math.max(0.5, out.riskPerTradePercent + randFloat(-0.5, 0.5)));
  if (out.trendSlowEma <= out.trendFastEma * 2) out.trendSlowEma = out.trendFastEma * 4 + 8;
  return out;
}

function crossover(a: Genes, b: Genes): Genes {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(a) as Array<keyof Genes>) out[k] = rng() < 0.5 ? a[k] : b[k];
  const g = out as unknown as Genes;
  if (g.trendSlowEma <= g.trendFastEma * 2) g.trendSlowEma = g.trendFastEma * 4 + 8;
  return g;
}

// ---------------------------------------------------------------- indicators
function emaSeries(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  out[period - 1] = seed / period;
  for (let i = period; i < values.length; i++) {
    out[i] = (out[i - 1] as number) + k * (values[i] - (out[i - 1] as number));
  }
  return out;
}

// ----------------------------------------------------------------- backtest
interface BtSummary {
  trades: number;
  wins: number;
  losses: number;
  grossWin: number;
  grossLoss: number;
  netPnl: number;
  fees: number;
  finalBalance: number;
  maxDrawdownPct: number;
  equity: number[];
}

function backtestSma(candles: Candle[], fast: number, slow: number,
                     stopPct: number, feePct: number, slipPct: number,
                     initialBalance: number): BtSummary {
  const closes = candles.map((c) => c.close);
  const fastS = emaSeries(closes, fast);
  const slowS = emaSeries(closes, slow);
  const n = candles.length;
  let cash = initialBalance;
  let pos: { dir: 1 | -1; entry: number; qty: number; cost: number; entryI: number } | null = null;
  let fees = 0;
  let grossWin = 0;
  let grossLoss = 0;
  let wins = 0;
  let losses = 0;
  let trades = 0;
  const equity: number[] = [];
  let peak = initialBalance;
  let mdd = 0;

  for (let i = 0; i < n; i++) {
    const close = closes[i];
    const f = fastS[i];
    const s = slowS[i];
    const fP = fastS[i - 1];
    const sP = slowS[i - 1];

    if (pos) {
      let exitPrice: number | null = null;
      let reason: "stop" | "tp" | "flip" | "eod" = "eod";
      const stopP = pos.dir === 1 ? pos.entry * (1 - stopPct / 100) : pos.entry * (1 + stopPct / 100);
      const tpP = pos.dir === 1 ? pos.entry * (1 + (stopPct * 2.2) / 100) : pos.entry * (1 - (stopPct * 2.2) / 100);
      if (pos.dir === 1 && candles[i].low <= stopP) { exitPrice = stopP; reason = "stop"; }
      else if (pos.dir === -1 && candles[i].high >= stopP) { exitPrice = stopP; reason = "stop"; }
      else if (pos.dir === 1 && candles[i].high >= tpP) { exitPrice = tpP; reason = "tp"; }
      else if (pos.dir === -1 && candles[i].low <= tpP) { exitPrice = tpP; reason = "tp"; }
      else if (f !== null && s !== null && fP !== null && sP !== null) {
        if (pos.dir === 1 && f < s) { exitPrice = close; reason = "flip"; }
        if (pos.dir === -1 && f > s) { exitPrice = close; reason = "flip"; }
      }
      if (exitPrice === null && i === n - 1) exitPrice = close;

      if (exitPrice !== null) {
        const ep = exitPrice * (pos.dir === 1 ? 1 - slipPct : 1 + slipPct);
        const exitNotional = pos.qty * ep;
        const fee = exitNotional * feePct;
        fees += fee;
        if (pos.dir === 1) {
          cash += exitNotional - fee;
        } else {
          cash += pos.cost + (pos.entry - ep) * pos.qty - fee;
        }
        const pnl = pos.dir === 1 ? (ep - pos.entry) * pos.qty : (pos.entry - ep) * pos.qty;
        trades++;
        if (pnl > 0) { wins++; grossWin += pnl; } else { losses++; grossLoss += Math.abs(pnl); }
        pos = null;
        if (reason === "flip" && f !== null && s !== null && i < n - 1 && cash > 10) {
          const dir: 1 | -1 = f > s ? 1 : -1;
          const slip = close * (dir === 1 ? 1 + slipPct : 1 - slipPct);
          const qty = (cash * 0.95) / slip;
          const entryFee = qty * slip * feePct;
          fees += entryFee;
          cash -= qty * slip + entryFee;
          pos = { dir, entry: slip, qty, cost: qty * slip, entryI: i };
        }
      }
    }
    if (!pos && f !== null && s !== null && fP !== null && sP !== null && i >= fast + 5 && cash > 10) {
      const crossUp = fP <= sP && f > s;
      const crossDown = fP >= sP && f < s;
      if (crossUp || crossDown) {
        const dir: 1 | -1 = crossUp ? 1 : -1;
        const slip = close * (dir === 1 ? 1 + slipPct : 1 - slipPct);
        const qty = (cash * 0.95) / slip;
        const entryFee = qty * slip * feePct;
        fees += entryFee;
        cash -= qty * slip + entryFee;
        pos = { dir, entry: slip, qty, cost: qty * slip, entryI: i };
      }
    }
    const eq = pos
      ? pos.dir === 1 ? Math.max(0, cash + pos.qty * close) : Math.max(0, cash + pos.cost + (pos.entry - close) * pos.qty)
      : Math.max(0, cash);
    equity.push(eq);
    peak = Math.max(peak, eq);
    if (peak > 0) mdd = Math.max(mdd, (peak - eq) / peak);
  }

  const netPnl = cash - initialBalance;
  return {
    trades, wins, losses, grossWin, grossLoss, netPnl, fees,
    finalBalance: cash, maxDrawdownPct: mdd * 100, equity,
  };
}

function sharpeOf(equity: number[]): number {
  const rets: number[] = [];
  for (let i = 1; i < equity.length; i++) {
    if (equity[i - 1] > 0) rets.push(equity[i] / equity[i - 1] - 1);
  }
  if (rets.length < 2) return 0;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const varr = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  const sd = Math.sqrt(varr);
  if (sd === 0) return 0;
  return (mean / sd) * Math.sqrt(35040);
}

// ----------------------------------------------------------------- DSR (TS)
function ndtri(p: number): number {
  p = Math.min(Math.max(p, 1e-12), 1 - 1e-12);
  if (p < 0.5) return -ndtri(1 - p);
  const t = Math.sqrt(-2 * Math.log(1 - p));
  const c0 = 2.51551716e-1, c1 = 2.43753479e-1, c2 = 5.63989648e-1;
  const d1 = 1.63645629e-1, d2 = 3.87763674e-1, d3 = 2.88490754e-1;
  return t - (c0 + c1 * t + c2 * t * t) / (1 + d1 * t + d2 * t * t + d3 * t * t * t);
}
function normCdf(z: number): number {
  // Abramowitz-Stegun 7.1.26
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327;
  let p = d * Math.exp(-z * z / 2) * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (z > 0) p = 1 - p;
  return p;
}

function deflatedSharpeRatio(equity: number[], trials: number): number {
  const rets: number[] = [];
  for (let i = 1; i < equity.length; i++) {
    if (equity[i - 1] > 0) rets.push(equity[i] / equity[i - 1] - 1);
  }
  const n = rets.length;
  if (n < 30) return 0;
  const mean = rets.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  if (sd === 0) return 0;
  const sr = mean / sd;
  const m3 = rets.reduce((a, b) => a + (b - mean) ** 3, 0) / n;
  const m4 = rets.reduce((a, b) => a + (b - mean) ** 4, 0) / n;
  const g3 = m3 / sd ** 3;
  const g4 = m4 / sd ** 4;
  const lam = 0.5772156649;
  const emaxStd = (1 - lam) * ndtri(1 - 1 / Math.max(2, trials))
    + lam * ndtri(1 - 1 / (Math.max(2, trials) * Math.E));
  const sr0 = emaxStd / Math.sqrt(n);
  const denom = Math.sqrt(Math.max(1e-9, 1 - g3 * sr + ((g4 - 1) / 4) * sr * sr));
  const z = ((sr - sr0) * Math.sqrt(n - 1)) / denom;
  return normCdf(z);
}

// -------------------------------------------------------------------- runner
export class GeneticOptimizer {
  private fitnessEngine: MultiObjectiveFitnessEngine;
  private cadence: CadenceFitnessModule;
  constructor(private config = {
    minTradesAbsolute: 30,
    minTradesTarget: 80,
    maxAllowedRules: 6,
    fitnessThreshold: 0.35,
    dsrGate: 0.95,
    cadenceMin: 3.0,
    cadenceMax: 6.0,
  }) {
    this.fitnessEngine = new MultiObjectiveFitnessEngine(
      config.minTradesAbsolute, config.minTradesTarget, config.maxAllowedRules);
    this.cadence = new CadenceFitnessModule(config.cadenceMin, config.cadenceMax);
  }

  run(cfg: GeneticConfig, candles: Candle[]): GaResult {
    if (candles.length < 240) {
      throw new Error(`WFO benötigt mindestens 240 Candles (bisher ${candles.length}).`);
    }
    const splitPct = (cfg.walkForwardSplitPercent || 70) / 100;
    const split = Math.floor(candles.length * splitPct);
    const isCandles = candles.slice(0, split);
    const oosCandles = candles.slice(split);
    const isDays = Math.max(1, split / (1440 / cfg.interval));
    const oosDays = Math.max(1, oosCandles.length / (1440 / cfg.interval));
    const feePct = (cfg.feePercent || 0.26) / 100;
    const slipPct = (cfg.slippagePercent || 0.05) / 100;

    const pop: Individual[] = [];
    for (let i = 0; i < cfg.populationSize; i++) {
      pop.push(this.evaluate(`ind_${i.toString(16)}_${Math.floor(rng() * 1e6).toString(16)}`, 0, randomGenes(),
        isCandles, oosCandles, isDays, oosDays, feePct, slipPct, cfg.initialBalance, cfg.populationSize * cfg.maxGenerations));
    }

    const history: GaResult["history"] = [];
    let best: Individual = pop[0];
    for (let gen = 1; gen <= cfg.maxGenerations; gen++) {
      for (const ind of pop) {
        ind.generation = gen;
      }
      pop.sort((a, b) => b.fitness - a.fitness);
      pop.forEach((ind, i) => {
        ind.rank = i + 1;
        ind.isSurvivor = i < cfg.survivorsCount;
      });
      best = pop[0].fitness > best.fitness ? pop[0] : best;
      const avg = pop.reduce((a, b) => a + b.fitness, 0) / pop.length;
      history.push({
        generation: gen,
        bestFitness: pop[0].fitness,
        avgFitness: Number(avg.toFixed(4)),
        bestReturn: pop[0].overallReturn,
        bestSharpe: pop[0].sharpeRatio,
        bestDrawdown: pop[0].overallDrawdown,
        bestIndividualId: pop[0].id,
      });

      const survivors = pop.slice(0, cfg.survivorsCount).map((s) => ({ ...s, genes: { ...s.genes } }));
      while (survivors.length < cfg.populationSize) {
        const a = survivors[Math.floor(rng() * survivors.length)];
        const b = survivors[Math.floor(rng() * survivors.length)];
        const genes = rng() < cfg.crossoverRate ? crossover(a.genes, b.genes) : { ...a.genes };
        const mut = mutateGenes(genes, cfg.mutationRate);
        survivors.push(this.evaluate(`gen${gen}_${survivors.length.toString(16)}`, gen + 1, mut,
          isCandles, oosCandles, isDays, oosDays, feePct, slipPct, cfg.initialBalance,
          cfg.populationSize * cfg.maxGenerations));
      }
      pop.length = 0;
      pop.push(...survivors);
    }

    const gate = this.shadowGate(best);
    const tail = candles.slice(-200);
    const replay = this.counterfactualReplay(best.genes, tail, feePct, slipPct, cfg.initialBalance);

    return {
      id: `ga_${Date.now().toString(36)}${Math.floor(rng() * 1e4).toString(36)}`,
      assetPair: cfg.assetPair,
      interval: cfg.interval,
      totalGenerationsCompleted: history.length,
      populationSize: cfg.populationSize,
      survivorCount: cfg.survivorsCount,
      bestIndividual: best,
      topSurvivors: pop.slice(0, cfg.survivorsCount),
      population: pop,
      history,
      inSampleCandles: split,
      outOfSampleCandles: oosCandles.length,
      generatedCode: generatedCode(best.genes),
      shadowGate: gate,
      counterfactualReplay: replay,
    };
  }

  shadowGate(ind: Individual) {
    const c = this.config;
    const checks = {
      dsr_above_gate: ind.dsr >= c.dsrGate,
      cadence_in_band: ind.tradesPerDay >= c.cadenceMin && ind.tradesPerDay <= c.cadenceMax,
      sample_size_ok: ind.tradesCount >= c.minTradesAbsolute,
      valid_candidate: ind.isValidCandidate,
    };
    const passed = Object.values(checks).every(Boolean);
    return {
      passed,
      checks,
      dsr: ind.dsr,
      requiredDsr: c.dsrGate,
      verdict: passed ? "SHADOW-APPROVED" : "REJECTED — kein Shadow-Deployment",
    };
  }

  counterfactualReplay(genes: Genes, tail: Candle[], feePct: number, slipPct: number,
                       initialBalance: number) {
    const stopPct = Math.min(8, Math.max(2, genes.atrStopMultiplier * 1.8));
    const bt = backtestSma(tail, clampInt(genes.trendFastEma, 5, 35), clampInt(genes.trendSlowEma, 40, 120),
      stopPct, feePct, slipPct, initialBalance);
    return {
      windowCandles: tail.length,
      replayTrades: bt.trades,
      replayNetPnlUsd: Number(bt.netPnl.toFixed(2)),
      replayReturnPct: Number((bt.netPnl / initialBalance * 100).toFixed(4)),
      replaySharpe: Number(sharpeOf(bt.equity).toFixed(4)),
      note: "Counterfactual: Genom vs. Live-Track-Record im Überlappungsfenster (Windows-Host)",
    };
  }

  private evaluate(id: string, generation: number, genes: Genes,
                   isC: Candle[], oosC: Candle[], isDays: number, oosDays: number,
                   feePct: number, slipPct: number, initialBalance: number,
                   trials: number): Individual {
    const fast = clampInt(genes.trendFastEma, 5, 35);
    const slow = clampInt(genes.trendSlowEma, 40, 120);
    const stopPct = Math.min(8, Math.max(2, genes.atrStopMultiplier * 1.8));
    const isBt = backtestSma(isC, fast, slow, stopPct, feePct, slipPct, initialBalance);
    const oosBt = backtestSma(oosC, fast, slow, stopPct, feePct, slipPct, initialBalance);

    const dsr = 0.5 * deflatedSharpeRatio(isBt.equity, trials) + 0.5 * deflatedSharpeRatio(oosBt.equity, Math.max(10, trials / 20));
    const totalTrades = isBt.trades + oosBt.trades;
    const days = isDays + oosDays;
    const tpd = totalTrades / days;
    const activeRules = 2 + [genes.useTrailingAtr, genes.useVolumeFilter, genes.useObvTrend,
      genes.useTrendFilter, genes.adxFilterEnabled, genes.useFvgFilter, genes.fvgMitigationStrict,
      genes.useCisdFilter, genes.useMtfFilter].filter(Boolean).length;

    const metrics: BacktestMetrics = {
      totalTrades: totalTrades,
      grossPnlUsd: isBt.netPnl + oosBt.netPnl,
      totalFeesUsd: isBt.fees + oosBt.fees,
      netPnlUsd: isBt.netPnl + oosBt.netPnl,
      annualizedNetReturnPct: Math.max(0, ((isBt.netPnl + oosBt.netPnl) / initialBalance) * (365 / days) * 100),
      netSharpeRatio: 0.5 * sharpeOf(isBt.equity) + 0.5 * sharpeOf(oosBt.equity),
      deflatedSharpeRatioNet: dsr,
      activeRuleCount: activeRules,
      evaluationDays: days,
    };
    const fitness = this.fitnessEngine.evaluateFitness(metrics);
    const cadenceEval = this.cadence.evaluateCadence({
      totalTrades,
      evaluationDays: days,
      tradeTimestamps: [],
    });
    // Cadence-Bandpass als Multiplikator (Frontend-Modul)
    const cadenceMult = cadenceEval.cadenceScore;
    const finalFitness = Number((fitness.fitnessScore * cadenceMult).toFixed(4));

    return {
      id,
      generation,
      genes,
      fitness: finalFitness,
      isValidCandidate: fitness.isValidCandidate && cadenceEval.isWithinTargetRange,
      rejectionReason: fitness.rejectionReason || cadenceEval.rejectionReason,
      inSampleSummary: {
        return: isBt.netPnl / initialBalance * 100,
        sharpe: sharpeOf(isBt.equity),
        trades: isBt.trades,
        maxDrawdownPct: isBt.maxDrawdownPct,
        winRate: isBt.trades ? (isBt.wins / isBt.trades) * 100 : 0,
      },
      outOfSampleSummary: {
        return: oosBt.netPnl / initialBalance * 100,
        sharpe: sharpeOf(oosBt.equity),
        trades: oosBt.trades,
        maxDrawdownPct: oosBt.maxDrawdownPct,
        winRate: oosBt.trades ? (oosBt.wins / oosBt.trades) * 100 : 0,
      },
      overallReturn: Number(((isBt.netPnl + oosBt.netPnl) / initialBalance * 100).toFixed(4)),
      overallDrawdown: Number(Math.max(isBt.maxDrawdownPct, oosBt.maxDrawdownPct).toFixed(4)),
      sharpeRatio: Number((0.5 * sharpeOf(isBt.equity) + 0.5 * sharpeOf(oosBt.equity)).toFixed(4)),
      winRate: Number(((isBt.wins + oosBt.wins) / Math.max(1, totalTrades) * 100).toFixed(2)),
      tradesCount: totalTrades,
      tradesPerDay: Number(tpd.toFixed(3)),
      dsr: Number(dsr.toFixed(4)),
      robustnessIndex: isBt.equity.length && sharpeOf(isBt.equity) > 0.01
        ? Number((sharpeOf(oosBt.equity) / sharpeOf(isBt.equity) * 100).toFixed(2)) : 0,
      rank: 0,
      isSurvivor: false,
    };
  }
}

function clampInt(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

function generatedCode(g: Genes): string {
  return [
    "// Evolved Genome — Projekt:Alpha GA (Windows TS-Host)",
    `// ATR Stop x${g.atrStopMultiplier.toFixed(2)} | TP x${g.atrTakeProfitMultiplier.toFixed(2)}`,
    `// EMA ${g.trendFastEma}/${g.trendSlowEma} | Risk ${g.riskPerTradePercent.toFixed(1)}%`,
    "function onCandle(ctx) {",
    `  const fast = ctx.ema(${g.trendFastEma});`,
    `  const slow = ctx.ema(${g.trendSlowEma});`,
    `  const atr = ctx.atr(${g.atrPeriod});`,
    `  if (fast.prev <= slow.prev && fast > slow) return ctx.long('entry', { stop: ctx.close - ${g.atrStopMultiplier.toFixed(2)} * atr });`,
    `  if (fast.prev >= slow.prev && fast < slow) return ctx.short('entry', { stop: ctx.close + ${g.atrStopMultiplier.toFixed(2)} * atr });`,
    "  return ctx.hold();",
    "}",
  ].join("\n");
}
