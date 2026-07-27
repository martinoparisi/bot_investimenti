/**
 * Indicatori tecnici. Tutte le funzioni sono causali: il valore all'indice `i`
 * usa solo dati fino a `i` incluso. Questo è ciò che rende possibile usarli come
 * feature in un addestramento walk-forward senza look-ahead bias.
 *
 * Convenzione: le serie restituite hanno la stessa lunghezza dell'input, con
 * `NaN` nelle posizioni in cui l'indicatore non è ancora definito.
 */

export function sma(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  // Inizializzazione con la SMA delle prime `period` osservazioni (standard).
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** RSI di Wilder (smoothing esponenziale con alfa = 1/period). */
export function rsi(closes: number[], period = 14): number[] {
  const out = new Array<number>(closes.length).fill(NaN);
  if (closes.length <= period) return out;

  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);

  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export interface MacdResult {
  macd: number[];
  signal: number[];
  histogram: number[];
}

export function macd(closes: number[], fast = 12, slow = 26, signalPeriod = 9): MacdResult {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const line = closes.map((_, i) =>
    Number.isNaN(emaFast[i]) || Number.isNaN(emaSlow[i]) ? NaN : emaFast[i] - emaSlow[i],
  );

  // La EMA del segnale va calcolata solo sulla parte definita della linea MACD.
  const firstValid = line.findIndex((v) => !Number.isNaN(v));
  const signal = new Array<number>(closes.length).fill(NaN);
  if (firstValid >= 0) {
    const tail = ema(line.slice(firstValid), signalPeriod);
    for (let i = 0; i < tail.length; i++) signal[firstValid + i] = tail[i];
  }

  const histogram = line.map((v, i) =>
    Number.isNaN(v) || Number.isNaN(signal[i]) ? NaN : v - signal[i],
  );
  return { macd: line, signal, histogram };
}

export interface BollingerResult {
  middle: number[];
  upper: number[];
  lower: number[];
  /** Posizione del prezzo nella banda: 0 = banda inferiore, 1 = superiore. */
  percentB: number[];
}

export function bollinger(closes: number[], period = 20, mult = 2): BollingerResult {
  const middle = sma(closes, period);
  const upper = new Array<number>(closes.length).fill(NaN);
  const lower = new Array<number>(closes.length).fill(NaN);
  const percentB = new Array<number>(closes.length).fill(NaN);

  for (let i = period - 1; i < closes.length; i++) {
    const window = closes.slice(i - period + 1, i + 1);
    const m = middle[i];
    const variance = window.reduce((acc, v) => acc + (v - m) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    upper[i] = m + mult * sd;
    lower[i] = m - mult * sd;
    percentB[i] = sd === 0 ? 0.5 : (closes[i] - lower[i]) / (upper[i] - lower[i]);
  }
  return { middle, upper, lower, percentB };
}

/** Average True Range (Wilder). */
export function atr(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
): number[] {
  const out = new Array<number>(closes.length).fill(NaN);
  if (closes.length <= period) return out;

  const tr: number[] = [highs[0] - lows[0]];
  for (let i = 1; i < closes.length; i++) {
    tr.push(
      Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1]),
      ),
    );
  }

  let prev = tr.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  out[period] = prev;
  for (let i = period + 1; i < closes.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

/** On Balance Volume. */
export function obv(closes: number[], volumes: number[]): number[] {
  const out = new Array<number>(closes.length).fill(0);
  for (let i = 1; i < closes.length; i++) {
    const dir = Math.sign(closes[i] - closes[i - 1]);
    out[i] = out[i - 1] + dir * (volumes[i] ?? 0);
  }
  return out;
}

/** Momentum semplice: rendimento sugli ultimi `period` periodi. */
export function momentum(closes: number[], period = 20): number[] {
  return closes.map((c, i) => (i < period ? NaN : c / closes[i - period] - 1));
}

/** Ultimo valore non-NaN di una serie, oppure `null`. */
export function last(values: number[]): number | null {
  for (let i = values.length - 1; i >= 0; i--) {
    if (Number.isFinite(values[i])) return values[i];
  }
  return null;
}
