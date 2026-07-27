/**
 * Orchestratore: prende i prezzi, applica la matematica, restituisce l'analisi.
 * È l'unico punto in cui dati e statistica si incontrano; le route API e il cron
 * usano solo queste funzioni.
 */

import {
  atr,
  bollinger,
  last,
  macd,
  rsi,
  sma,
} from "./analytics/indicators";
import {
  detectPatterns,
  patternAnalysis,
  type DetectedPattern,
} from "./analytics/patterns";
import { horizonFor, PERIODS, type PeriodId } from "./analytics/periods";
import { analyzeProbability, trendScore, type ProbabilityResult } from "./analytics/probability";
import {
  annualizeVol,
  beta,
  conditionalVaR,
  excessKurtosis,
  historicalVaR,
  logReturns,
  maxDrawdown,
  pairedLogReturns,
  sharpe,
  skewness,
  sortino,
} from "./analytics/returns";
import { computeSignal, type SignalResult } from "./analytics/signal";
import { saveSnapshots, type StoredSnapshot } from "./db";
import { fetchDailyHistory, type Candle } from "./data/yahoo";
import { benchmarkFor, lookupConstituent } from "./data/universe";

export interface StockAnalysis {
  symbol: string;
  name: string | null;
  currency: string;
  exchange: string;
  period: PeriodId;
  horizonDays: number;
  price: number;
  previousClose: number;
  /** Variazione sull'ultima seduta. */
  changePercent: number;
  /** Variazione sull'intero periodo analizzato. */
  periodChangePercent: number;
  probability: ProbabilityResult;
  signal: SignalResult;
  stats: {
    volatilityAnnual: number;
    sharpe: number;
    sortino: number;
    maxDrawdown: number;
    var95: number;
    cvar95: number;
    skewness: number;
    excessKurtosis: number;
    beta: number | null;
    rsi: number | null;
    macdHistogram: number | null;
    percentB: number | null;
    sma50: number | null;
    sma200: number | null;
    distanceFromSma200: number | null;
    atr: number | null;
    atrPercent: number | null;
    relativeVolume: number | null;
    fiftyTwoWeekHigh: number | null;
    fiftyTwoWeekLow: number | null;
    positionIn52w: number | null;
    trend: number;
    /** Sintesi degli schemi grafici attivi, da -1 (ribassisti) a +1 (rialzisti). */
    patternScore: number;
    /** Movimento atteso a 1 sigma sull'orizzonte, in percentuale. */
    expectedMovePercent: number;
    expectedReturnPercent: number;
  };
  /** Schemi grafici ancora in vigore, dal più rilevante. */
  patterns: DetectedPattern[];
  /** Rendimento medio per mese solare, in percentuale. */
  seasonality: { month: number; averageReturn: number; samples: number }[];
  /** Ultime chiusure, per i mini-grafici delle classifiche. */
  sparkline: number[];
  dataPoints: number;
  computedAt: number;
}

/** Versione compatta usata dalle classifiche (leggera da serializzare). */
export interface RankedStock {
  symbol: string;
  name: string;
  currency: string;
  price: number;
  changePercent: number;
  periodChangePercent: number;
  pUp: number;
  pDown: number;
  confidence: number;
  buy: number;
  sell: number;
  keep: number;
  verdict: SignalResult["verdict"];
  volatilityAnnual: number;
  expectedReturnPercent: number;
  sparkline: number[];
  computedAt: number;
}

function seasonalityOf(candles: Candle[]) {
  const byMonth = new Map<number, number[]>();
  for (let i = 1; i < candles.length; i++) {
    const month = new Date(candles[i].time * 1000).getUTCMonth();
    const ret = candles[i].close / candles[i - 1].close - 1;
    if (!Number.isFinite(ret)) continue;
    const arr = byMonth.get(month) ?? [];
    arr.push(ret);
    byMonth.set(month, arr);
  }
  return Array.from({ length: 12 }, (_, month) => {
    const values = byMonth.get(month) ?? [];
    const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    // Rendimento medio giornaliero del mese, riportato su un mese di 21 sedute.
    return { month, averageReturn: avg * 21 * 100, samples: values.length };
  });
}

/**
 * Analizza un titolo. `benchmark` è una mappa data → chiusura dell'indice di
 * riferimento: passarla evita di riscaricarlo per ogni titolo dello stesso
 * indice, e permette di allineare le due serie per data (necessario per il beta).
 */
export async function analyzeSymbol(
  symbol: string,
  period: PeriodId,
  benchmark?: BenchmarkSeries,
): Promise<StockAnalysis> {
  const def = PERIODS[period];
  const history = await fetchDailyHistory(symbol, def.lookbackDays);
  const candles = history.candles;
  if (candles.length < 2) {
    throw new Error(`storico insufficiente per ${symbol}`);
  }

  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const volumes = candles.map((c) => c.volume);
  const times = candles.map((c) => c.time);
  const returns = logReturns(closes);

  const horizonDays = horizonFor(period);
  // Gli schemi si calcolano una volta sola: servono sia come feature del modello
  // sia come elenco da mostrare nella scheda titolo.
  const shape = patternAnalysis(highs, lows, closes, volumes);
  const patternScore = shape.pattern[shape.pattern.length - 1] ?? 0;
  const probability = analyzeProbability(closes, horizonDays, shape);

  const rsiValue = last(rsi(closes, 14));
  const { histogram } = macd(closes);
  const { percentB } = bollinger(closes);
  const sma50 = last(sma(closes, 50));
  const sma200 = last(sma(closes, 200));
  const atrValue = last(atr(highs, lows, closes, 14));
  const trend = trendScore(closes);

  const price = history.meta.regularMarketPrice || closes[closes.length - 1];
  // `chartPreviousClose` di Yahoo si riferisce alla chiusura PRIMA dell'inizio
  // del range richiesto (qui anni fa), non a ieri: va usata la penultima barra.
  const previousClose = closes[closes.length - 2] ?? price;

  // Variazione sul periodo: confronto con la chiusura di `horizonDays` sedute fa.
  const periodStartIndex = Math.max(0, closes.length - 1 - horizonDays);
  const periodChangePercent =
    closes[periodStartIndex] > 0 ? (price / closes[periodStartIndex] - 1) * 100 : 0;

  const recentVolume = volumes.slice(-20).filter((v) => v > 0);
  const avgVolume = recentVolume.length
    ? recentVolume.reduce((a, b) => a + b, 0) / recentVolume.length
    : 0;
  const lastVolume = volumes[volumes.length - 1] ?? 0;

  const high52 = history.meta.fiftyTwoWeekHigh ?? Math.max(...closes.slice(-252));
  const low52 = history.meta.fiftyTwoWeekLow ?? Math.min(...closes.slice(-252));

  const cvar95 = conditionalVaR(returns, 0.95);
  const dd = maxDrawdown(closes);

  // Il beta richiede le due serie allineate per data, non per posizione.
  const benchmarkBeta = benchmark
    ? (() => {
        const paired = pairedLogReturns(times, closes, benchmark);
        return beta(paired.asset, paired.benchmark);
      })()
    : null;

  const signal = computeSignal({
    pUp: probability.pUp,
    confidence: probability.confidence,
    expectedReturn: probability.expectedReturn,
    sigmaHorizon: probability.sigmaHorizon,
    trend,
    patternScore,
    rsi: rsiValue,
    cvar95,
    maxDrawdown: dd.maxDrawdown,
  });

  const constituent = lookupConstituent(symbol)?.constituent;

  return {
    symbol: history.meta.symbol || symbol,
    name: constituent?.name ?? history.meta.longName,
    currency: history.meta.currency || constituent?.currency || "",
    exchange: history.meta.fullExchangeName,
    period,
    horizonDays,
    price,
    previousClose,
    changePercent: previousClose > 0 ? (price / previousClose - 1) * 100 : 0,
    periodChangePercent,
    probability,
    signal,
    stats: {
      volatilityAnnual: annualizeVol(probability.volDaily) * 100,
      sharpe: sharpe(returns),
      sortino: sortino(returns),
      maxDrawdown: dd.maxDrawdown * 100,
      var95: historicalVaR(returns, 0.95) * 100,
      cvar95: cvar95 * 100,
      skewness: skewness(returns),
      excessKurtosis: excessKurtosis(returns),
      beta: benchmarkBeta,
      rsi: rsiValue,
      macdHistogram: last(histogram),
      percentB: last(percentB),
      sma50,
      sma200,
      distanceFromSma200: sma200 && sma200 > 0 ? (price / sma200 - 1) * 100 : null,
      atr: atrValue,
      atrPercent: atrValue && price > 0 ? (atrValue / price) * 100 : null,
      relativeVolume: avgVolume > 0 ? lastVolume / avgVolume : null,
      fiftyTwoWeekHigh: high52,
      fiftyTwoWeekLow: low52,
      positionIn52w: high52 > low52 ? ((price - low52) / (high52 - low52)) * 100 : null,
      trend,
      patternScore,
      expectedMovePercent: probability.sigmaHorizon * 100,
      expectedReturnPercent: probability.expectedReturn * 100,
    },
    patterns: detectPatterns(candles, shape),
    seasonality: seasonalityOf(candles),
    sparkline: closes.slice(-40),
    dataPoints: candles.length,
    computedAt: Date.now(),
  };
}

export function toRanked(
  analysis: StockAnalysis,
  sparkline: number[] = analysis.sparkline,
): RankedStock {
  return {
    symbol: analysis.symbol,
    name: analysis.name ?? analysis.symbol,
    currency: analysis.currency,
    price: analysis.price,
    changePercent: analysis.changePercent,
    periodChangePercent: analysis.periodChangePercent,
    pUp: analysis.probability.pUp,
    pDown: analysis.probability.pDown,
    confidence: analysis.probability.confidence,
    buy: analysis.signal.buy,
    sell: analysis.signal.sell,
    keep: analysis.signal.keep,
    verdict: analysis.signal.verdict,
    volatilityAnnual: analysis.stats.volatilityAnnual,
    expectedReturnPercent: analysis.stats.expectedReturnPercent,
    sparkline,
    computedAt: analysis.computedAt,
  };
}

/** Serie dell'indice di riferimento indicizzata per data (secondi epoch). */
export type BenchmarkSeries = Map<number, number>;

const benchmarkCache = new Map<string, { series: BenchmarkSeries; at: number }>();
const BENCHMARK_TTL = 15 * 60 * 1000;

export async function getBenchmarkSeries(symbol: string): Promise<BenchmarkSeries> {
  const bench = benchmarkFor(symbol);
  const cached = benchmarkCache.get(bench);
  if (cached && Date.now() - cached.at < BENCHMARK_TTL) return cached.series;
  try {
    const history = await fetchDailyHistory(bench, 1260);
    const series: BenchmarkSeries = new Map(history.candles.map((c) => [c.time, c.close]));
    benchmarkCache.set(bench, { series, at: Date.now() });
    return series;
  } catch {
    return new Map();
  }
}

/**
 * Analizza molti titoli e salva ogni risultato appena è pronto. Gli errori sui
 * singoli simboli non fermano il lotto: con 750 titoli è normale che qualcuno
 * sia stato delistato o rinominato.
 *
 * Il salvataggio è per titolo, non a fine lotto: la dashboard vede i risultati
 * mentre l'analisi è ancora in corso, e un timeout della funzione serverless non
 * butta via il lavoro già fatto.
 *
 * ponytail: una INSERT per titolo invece di una a blocchi. Righe minuscole, il
 * collo di bottiglia è Yahoo; se le scritture diventassero un costo, accumulare
 * e scaricare ogni N.
 */
export async function analyzeMany(
  symbols: string[],
  period: PeriodId,
): Promise<{ analyses: StockAnalysis[]; failed: string[]; snapshots: StoredSnapshot[] }> {
  const analyses: StockAnalysis[] = [];
  const failed: string[] = [];
  const snapshots: StoredSnapshot[] = [];

  // La concorrenza vera è imposta dal limitatore dentro lib/data/yahoo.ts.
  await Promise.all(
    symbols.map(async (symbol) => {
      // La chiave è SEMPRE il simbolo richiesto: Yahoo a volte risponde con
      // quello nuovo dopo una ridenominazione, e salvarlo con quello lascerebbe
      // il titolo "da calcolare" per sempre.
      let snapshot: StoredSnapshot;
      try {
        const benchmark = await getBenchmarkSeries(symbol);
        const analysis = await analyzeSymbol(symbol, period, benchmark);
        analyses.push(analysis);
        snapshot = {
          symbol,
          period,
          computedAt: analysis.computedAt,
          metrics: toRanked(analysis) as unknown as Record<string, unknown>,
        };
      } catch {
        failed.push(symbol);
        // Riga segnaposto: senza, un titolo che non si scarica resterebbe da
        // calcolare a ogni giro e la barra di avanzamento non arriverebbe mai in
        // fondo. Scade con lo stesso TTL degli altri, quindi verrà riprovato.
        snapshot = { symbol, period, computedAt: Date.now(), metrics: { symbol, failed: true } };
      }
      snapshots.push(snapshot);
      await saveSnapshots([snapshot]);
    }),
  );

  return { analyses, failed, snapshots };
}
