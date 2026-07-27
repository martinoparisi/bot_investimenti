/**
 * Statistiche di rendimento e rischio su serie di prezzi.
 * Tutto in log-rendimenti: sono additivi nel tempo, il che rende corretta
 * l'aggregazione su orizzonti multipli (i rendimenti semplici no).
 */

export const TRADING_DAYS_PER_YEAR = 252;

export function logReturns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0 && closes[i] > 0) out.push(Math.log(closes[i] / closes[i - 1]));
  }
  return out;
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Deviazione standard campionaria (denominatore n-1). */
export function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Volatilità EWMA (RiskMetrics, lambda = 0.94 su dati giornalieri).
 * Pesa di più il passato recente: cattura i cambi di regime molto prima
 * della deviazione standard su finestra fissa.
 */
export function ewmaVol(returns: number[], lambda = 0.94): number {
  if (returns.length === 0) return 0;
  // Seed con la varianza delle prime osservazioni disponibili.
  const seedSize = Math.min(returns.length, 20);
  let variance = returns.slice(0, seedSize).reduce((acc, r) => acc + r * r, 0) / seedSize;
  for (let i = seedSize; i < returns.length; i++) {
    variance = lambda * variance + (1 - lambda) * returns[i] * returns[i];
  }
  return Math.sqrt(variance);
}

/** Serie completa della volatilità EWMA (causale, un valore per osservazione). */
export function ewmaVolSeries(returns: number[], lambda = 0.94): number[] {
  const out = new Array<number>(returns.length).fill(NaN);
  if (returns.length === 0) return out;
  const seedSize = Math.min(returns.length, 20);
  let variance = returns.slice(0, seedSize).reduce((acc, r) => acc + r * r, 0) / seedSize;
  for (let i = 0; i < seedSize; i++) out[i] = Math.sqrt(variance);
  for (let i = seedSize; i < returns.length; i++) {
    variance = lambda * variance + (1 - lambda) * returns[i] * returns[i];
    out[i] = Math.sqrt(variance);
  }
  return out;
}

export function annualizeVol(dailyVol: number): number {
  return dailyVol * Math.sqrt(TRADING_DAYS_PER_YEAR);
}

/**
 * Drift giornaliero stimato con shrinkage verso zero.
 *
 * Il drift campionario di una serie di prezzi è quasi tutto rumore: l'errore
 * standard della media è sigma/sqrt(n), e con sigma giornaliera ~1.5% servono
 * decenni di dati per distinguere un drift reale dallo zero. Senza shrinkage
 * la probabilità stimata sarebbe dominata dal rumore del campione.
 *
 * Fattore applicato: n / (n + k), con k = 252 (un anno di dati "vale" metà).
 */
export function shrunkDrift(returns: number[], k = TRADING_DAYS_PER_YEAR): number {
  if (returns.length === 0) return 0;
  const raw = mean(returns);
  return raw * (returns.length / (returns.length + k));
}

export interface DrawdownResult {
  maxDrawdown: number;
  peakIndex: number;
  troughIndex: number;
}

export function maxDrawdown(closes: number[]): DrawdownResult {
  let peak = closes[0] ?? 0;
  let peakIndex = 0;
  let worst = 0;
  let worstPeak = 0;
  let worstTrough = 0;

  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > peak) {
      peak = closes[i];
      peakIndex = i;
    }
    const dd = peak > 0 ? closes[i] / peak - 1 : 0;
    if (dd < worst) {
      worst = dd;
      worstPeak = peakIndex;
      worstTrough = i;
    }
  }
  return { maxDrawdown: worst, peakIndex: worstPeak, troughIndex: worstTrough };
}

/** Sharpe ratio annualizzato. `riskFreeAnnual` in forma decimale (0.03 = 3%). */
export function sharpe(returns: number[], riskFreeAnnual = 0): number {
  const sd = stdev(returns);
  if (sd === 0) return 0;
  const excessDaily = mean(returns) - riskFreeAnnual / TRADING_DAYS_PER_YEAR;
  return (excessDaily / sd) * Math.sqrt(TRADING_DAYS_PER_YEAR);
}

/** Sortino: come Sharpe ma penalizza solo la volatilità al ribasso. */
export function sortino(returns: number[], riskFreeAnnual = 0): number {
  const downside = returns.filter((r) => r < 0);
  if (downside.length < 2) return 0;
  const dd = Math.sqrt(downside.reduce((acc, r) => acc + r * r, 0) / downside.length);
  if (dd === 0) return 0;
  const excessDaily = mean(returns) - riskFreeAnnual / TRADING_DAYS_PER_YEAR;
  return (excessDaily / dd) * Math.sqrt(TRADING_DAYS_PER_YEAR);
}

/**
 * VaR storico: perdita che non viene superata con probabilità `confidence`.
 * Restituito come numero negativo (es. -0.031 = -3,1%).
 */
export function historicalVaR(returns: number[], confidence = 0.95): number {
  if (returns.length === 0) return 0;
  const sorted = [...returns].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((1 - confidence) * sorted.length)));
  return sorted[idx];
}

/** CVaR / Expected Shortfall: perdita media nella coda oltre il VaR. */
export function conditionalVaR(returns: number[], confidence = 0.95): number {
  if (returns.length === 0) return 0;
  const sorted = [...returns].sort((a, b) => a - b);
  const cutoff = Math.max(1, Math.floor((1 - confidence) * sorted.length));
  return mean(sorted.slice(0, cutoff));
}

export function skewness(returns: number[]): number {
  const n = returns.length;
  if (n < 3) return 0;
  const m = mean(returns);
  const sd = stdev(returns);
  if (sd === 0) return 0;
  const sum = returns.reduce((acc, r) => acc + ((r - m) / sd) ** 3, 0);
  return (n / ((n - 1) * (n - 2))) * sum;
}

/** Curtosi in eccesso (0 = distribuzione normale). */
export function excessKurtosis(returns: number[]): number {
  const n = returns.length;
  if (n < 4) return 0;
  const m = mean(returns);
  const sd = stdev(returns);
  if (sd === 0) return 0;
  const sum = returns.reduce((acc, r) => acc + ((r - m) / sd) ** 4, 0);
  const g2 = ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * sum;
  return g2 - (3 * (n - 1) ** 2) / ((n - 2) * (n - 3));
}

/**
 * Log-rendimenti di due serie allineati per data.
 *
 * Allineare "dalla coda" non basta: se una delle due serie ha una seduta in più
 * (festività locale, sospensione, barra parziale di oggi) tutti i rendimenti
 * risultano sfasati di un giorno e la correlazione crolla a zero. Qui si
 * tengono solo le date presenti in entrambe.
 */
export function pairedLogReturns(
  times: number[],
  closes: number[],
  benchmark: Map<number, number>,
): { asset: number[]; benchmark: number[] } {
  const a: number[] = [];
  const b: number[] = [];
  for (let i = 0; i < times.length; i++) {
    const benchClose = benchmark.get(times[i]);
    if (benchClose !== undefined && closes[i] > 0 && benchClose > 0) {
      a.push(closes[i]);
      b.push(benchClose);
    }
  }
  return { asset: logReturns(a), benchmark: logReturns(b) };
}

/** Beta rispetto a un benchmark. Le due serie vengono allineate dalla coda. */
export function beta(assetReturns: number[], benchmarkReturns: number[]): number | null {
  const n = Math.min(assetReturns.length, benchmarkReturns.length);
  if (n < 20) return null;
  const a = assetReturns.slice(-n);
  const b = benchmarkReturns.slice(-n);
  const ma = mean(a);
  const mb = mean(b);
  let cov = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    cov += (a[i] - ma) * (b[i] - mb);
    varB += (b[i] - mb) ** 2;
  }
  if (varB === 0) return null;
  return cov / varB;
}

/** Rendimento semplice tra il primo e l'ultimo prezzo della serie. */
export function totalReturn(closes: number[]): number {
  if (closes.length < 2 || closes[0] <= 0) return 0;
  return closes[closes.length - 1] / closes[0] - 1;
}
