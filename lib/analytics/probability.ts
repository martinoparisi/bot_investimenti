/**
 * Stima della probabilità che il prezzo salga sull'orizzonte richiesto.
 *
 * Tre stimatori indipendenti, ciascuno con un difetto diverso:
 *
 *  1. EMPIRICO   — frequenza storica di finestre positive. Nessuna assunzione
 *                  di distribuzione, ma ignora completamente lo stato attuale.
 *  2. GBM        — modello parametrico su drift e volatilità correnti. Reattivo
 *                  ai cambi di regime, ma assume normalità dei log-rendimenti.
 *  3. LOGISTICO  — regressione su feature tecniche. Cattura pattern non lineari
 *                  del momentum, ma può sovradattarsi.
 *
 * I tre vengono combinati con pesi proporzionali a 1/(Brier score), misurato
 * SEMPRE fuori campione con validazione walk-forward. Chi ha predetto meglio in
 * passato su questo specifico titolo pesa di più.
 *
 * Nota sulle code: per la probabilità del SEGNO usiamo la normale. La curtosi in
 * eccesso influenza l'ampiezza dei movimenti molto più della loro direzione, e
 * viene riportata a parte fra le statistiche invece di essere infilata qui.
 */

import { bollinger, macd, momentum, rsi, sma } from "./indicators";
import {
  ewmaVolSeries,
  excessKurtosis,
  logReturns,
  TRADING_DAYS_PER_YEAR,
} from "./returns";

// --------------------------------------------------------------------------
// Utilità statistiche
// --------------------------------------------------------------------------

/** Funzione errore, approssimazione di Abramowitz & Stegun 7.1.26 (~1e-7). */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

/** CDF della normale standard. */
export function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

/**
 * Intervallo di Wilson per una proporzione.
 * Preferito a quello normale perché resta dentro [0,1] e non degenera
 * quando la proporzione si avvicina agli estremi o il campione è piccolo.
 */
export function wilsonInterval(
  successes: number,
  n: number,
  z = 1.96,
): [number, number] {
  if (n <= 0) return [0, 1];
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [clamp01(center - half), clamp01(center + half)];
}

export function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Brier score: errore quadratico medio di previsioni probabilistiche. */
export function brierScore(predictions: number[], outcomes: number[]): number {
  if (predictions.length === 0) return 0.25;
  let sum = 0;
  for (let i = 0; i < predictions.length; i++) {
    sum += (predictions[i] - outcomes[i]) ** 2;
  }
  return sum / predictions.length;
}

// --------------------------------------------------------------------------
// Regressione logistica (discesa del gradiente, regolarizzazione L2)
// --------------------------------------------------------------------------

export interface LogisticModel {
  weights: number[];
  bias: number;
  mu: number[];
  sigma: number[];
}

function sigmoid(z: number): number {
  if (z >= 0) return 1 / (1 + Math.exp(-z));
  const e = Math.exp(z);
  return e / (1 + e);
}

export function trainLogistic(
  X: number[][],
  y: number[],
  { iterations = 300, learningRate = 0.3, l2 = 0.01 } = {},
): LogisticModel {
  const n = X.length;
  const d = X[0]?.length ?? 0;
  if (n === 0 || d === 0) {
    return { weights: [], bias: 0, mu: [], sigma: [] };
  }

  // Standardizzazione: senza, le feature con scale diverse rendono la discesa
  // del gradiente instabile a parità di learning rate.
  const mu = new Array<number>(d).fill(0);
  const sigma = new Array<number>(d).fill(1);
  for (let j = 0; j < d; j++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += X[i][j];
    mu[j] = s / n;
    let v = 0;
    for (let i = 0; i < n; i++) v += (X[i][j] - mu[j]) ** 2;
    sigma[j] = Math.sqrt(v / n) || 1;
  }

  const Z = X.map((row) => row.map((v, j) => (v - mu[j]) / sigma[j]));
  const weights = new Array<number>(d).fill(0);
  let bias = 0;

  for (let it = 0; it < iterations; it++) {
    const gradW = new Array<number>(d).fill(0);
    let gradB = 0;
    for (let i = 0; i < n; i++) {
      let z = bias;
      for (let j = 0; j < d; j++) z += weights[j] * Z[i][j];
      const err = sigmoid(z) - y[i];
      gradB += err;
      for (let j = 0; j < d; j++) gradW[j] += err * Z[i][j];
    }
    bias -= (learningRate * gradB) / n;
    for (let j = 0; j < d; j++) {
      weights[j] -= learningRate * (gradW[j] / n + l2 * weights[j]);
    }
  }
  return { weights, bias, mu, sigma };
}

export function predictLogistic(model: LogisticModel, x: number[]): number {
  if (model.weights.length === 0) return 0.5;
  let z = model.bias;
  for (let j = 0; j < model.weights.length; j++) {
    z += model.weights[j] * ((x[j] - model.mu[j]) / model.sigma[j]);
  }
  return sigmoid(z);
}

// --------------------------------------------------------------------------
// Feature causali
// --------------------------------------------------------------------------

export const FEATURE_NAMES = [
  "rsi14",
  "macdHist",
  "distSma50",
  "distSma200",
  "momentum20",
  "regimeVol",
  "range52w",
] as const;

/** Indice minimo a cui tutte le feature sono definite (serve 1 anno di storia). */
const MIN_FEATURE_INDEX = 252;

export function buildFeatures(closes: number[]): (number[] | null)[] {
  const n = closes.length;
  const rsiSeries = rsi(closes, 14);
  const { histogram } = macd(closes);
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const mom20 = momentum(closes, 20);
  const rets = logReturns(closes);
  const volSeries = ewmaVolSeries(rets);

  const finiteVols = volSeries.filter(Number.isFinite).sort((a, b) => a - b);
  const medianVol = finiteVols.length
    ? finiteVols[Math.floor(finiteVols.length / 2)]
    : 0.01;

  const out: (number[] | null)[] = new Array(n).fill(null);
  for (let i = MIN_FEATURE_INDEX; i < n; i++) {
    // volSeries[i-1] è la volatilità stimata con i rendimenti fino a closes[i].
    const vol = volSeries[i - 1];
    const window = closes.slice(Math.max(0, i - 251), i + 1);
    const hi = Math.max(...window);
    const lo = Math.min(...window);

    const row = [
      (rsiSeries[i] - 50) / 50,
      closes[i] > 0 ? (histogram[i] / closes[i]) * 100 : NaN,
      sma50[i] > 0 ? closes[i] / sma50[i] - 1 : NaN,
      sma200[i] > 0 ? closes[i] / sma200[i] - 1 : NaN,
      mom20[i],
      vol > 0 && medianVol > 0 ? Math.log(vol / medianVol) : NaN,
      hi > lo ? (closes[i] - lo) / (hi - lo) - 0.5 : 0,
    ];
    out[i] = row.every(Number.isFinite) ? row : null;
  }
  return out;
}

// --------------------------------------------------------------------------
// Stimatore parametrico GBM
// --------------------------------------------------------------------------

/**
 * P(S_T > S_0) sotto moto browniano geometrico:
 *   P = Phi( (mu - sigma^2/2) * h / (sigma * sqrt(h)) )
 * con mu e sigma giornalieri e h in giorni di borsa.
 */
export function gbmProbability(
  driftDaily: number,
  volDaily: number,
  horizonDays: number,
): number {
  if (volDaily <= 0 || horizonDays <= 0) return 0.5;
  return clamp01(normalCdf(gbmZScore(driftDaily, volDaily, horizonDays)));
}

function gbmZScore(driftDaily: number, volDaily: number, horizonDays: number): number {
  const numerator = (driftDaily - (volDaily * volDaily) / 2) * horizonDays;
  return numerator / (volDaily * Math.sqrt(horizonDays));
}

/**
 * Intervallo di confidenza dello stimatore GBM, per il metodo delta.
 *
 * L'incertezza dominante è quella sul drift: l'errore standard di mu stimato su
 * n rendimenti è sigma/sqrt(n), e propagato dentro z = (mu - sigma^2/2)h/(sigma*sqrt(h))
 * diventa sd(z) = sqrt(h/n). Da qui l'intervallo su p, applicando Phi agli estremi.
 */
export function gbmInterval(
  driftDaily: number,
  volDaily: number,
  horizonDays: number,
  observations: number,
  z = 1.96,
): [number, number] {
  if (volDaily <= 0 || horizonDays <= 0 || observations < 2) return [0, 1];
  const center = gbmZScore(driftDaily, volDaily, horizonDays);
  const sd = Math.sqrt(horizonDays / observations);
  return [clamp01(normalCdf(center - z * sd)), clamp01(normalCdf(center + z * sd))];
}

// --------------------------------------------------------------------------
// Analisi completa
// --------------------------------------------------------------------------

export interface ProbabilityComponent {
  name: string;
  label: string;
  pUp: number;
  weight: number;
  brier: number | null;
  ci95: [number, number];
}

export interface ProbabilityResult {
  pUp: number;
  pDown: number;
  ci95: [number, number];
  confidence: number;
  horizonDays: number;
  /** Osservazioni indipendenti equivalenti (finestre non sovrapposte). */
  effectiveSamples: number;
  components: ProbabilityComponent[];
  /** Rendimento atteso sull'orizzonte (semplice, non annualizzato). */
  expectedReturn: number;
  /** Deviazione standard del log-rendimento sull'orizzonte. */
  sigmaHorizon: number;
  driftDaily: number;
  volDaily: number;
  excessKurtosis: number;
  /** `true` quando i dati non bastano e il risultato è poco informativo. */
  degraded: boolean;
}

const NUM_FOLDS = 4;
const SHRINK_K = TRADING_DAYS_PER_YEAR;

/** Media dei log-rendimenti fino a `end` (escluso) con shrinkage verso zero. */
function shrunkDriftPrefix(prefixSums: number[], end: number): number {
  if (end <= 0) return 0;
  const raw = prefixSums[end] / end;
  return raw * (end / (end + SHRINK_K));
}

export function analyzeProbability(
  closes: number[],
  horizonDays: number,
): ProbabilityResult {
  const h = Math.max(1, Math.round(horizonDays));
  const n = closes.length;
  const rets = logReturns(closes);
  const volSeries = ewmaVolSeries(rets);
  const kurt = excessKurtosis(rets);

  // Somme prefisse dei rendimenti: evita di ricalcolare la media a ogni punto.
  const prefix = new Array<number>(rets.length + 1).fill(0);
  for (let i = 0; i < rets.length; i++) prefix[i + 1] = prefix[i] + rets[i];

  const driftDaily = shrunkDriftPrefix(prefix, rets.length);
  const volDaily = volSeries.length ? volSeries[volSeries.length - 1] : 0;
  const sigmaHorizon = volDaily * Math.sqrt(h);
  const expectedReturn = Math.exp(driftDaily * h) - 1;

  // Indici con feature definite ed etichetta osservabile.
  const features = buildFeatures(closes);
  const labeled: number[] = [];
  for (let i = MIN_FEATURE_INDEX; i + h < n; i++) {
    if (features[i]) labeled.push(i);
  }

  const labelOf = (i: number): number => (closes[i + h] > closes[i] ? 1 : 0);

  // ---- Stimatore empirico su tutta la storia disponibile -------------------
  let empiricalSuccesses = 0;
  let empiricalTotal = 0;
  for (let i = 0; i + h < n; i++) {
    empiricalTotal++;
    if (closes[i + h] > closes[i]) empiricalSuccesses++;
  }
  const pEmpirical = empiricalTotal > 0 ? empiricalSuccesses / empiricalTotal : 0.5;

  // Le finestre si sovrappongono: il campione indipendente equivalente è
  // il numero di finestre non sovrapposte, non il numero di finestre.
  const effectiveSamples = Math.max(1, Math.floor(empiricalTotal / h));

  const pGbm = gbmProbability(driftDaily, volDaily, h);

  // ---- Validazione walk-forward -------------------------------------------
  const briers: Record<string, number | null> = {
    empirico: null,
    gbm: null,
    logistico: null,
  };
  let pLogistic: number | null = null;

  const MIN_LABELED = 120;
  if (labeled.length >= MIN_LABELED) {
    const oos: Record<string, { p: number[]; y: number[] }> = {
      empirico: { p: [], y: [] },
      gbm: { p: [], y: [] },
      logistico: { p: [], y: [] },
    };

    const blockSize = Math.floor(labeled.length / (NUM_FOLDS + 1));
    for (let fold = 0; fold < NUM_FOLDS; fold++) {
      const trainEnd = blockSize * (fold + 1);
      const testEnd = fold === NUM_FOLDS - 1 ? labeled.length : blockSize * (fold + 2);
      const trainIdx = labeled.slice(0, trainEnd);
      const testIdx = labeled.slice(trainEnd, testEnd);
      if (trainIdx.length < 40 || testIdx.length === 0) continue;

      const trainY = trainIdx.map(labelOf);
      const baseRate = trainY.reduce((a, b) => a + b, 0) / trainY.length;
      const model = trainLogistic(
        trainIdx.map((i) => features[i] as number[]),
        trainY,
      );

      for (const i of testIdx) {
        const y = labelOf(i);
        oos.empirico.p.push(baseRate);
        oos.empirico.y.push(y);

        // Parametri stimati solo con i dati disponibili all'istante i.
        const driftAt = shrunkDriftPrefix(prefix, i);
        const volAt = Number.isFinite(volSeries[i - 1]) ? volSeries[i - 1] : volDaily;
        oos.gbm.p.push(gbmProbability(driftAt, volAt, h));
        oos.gbm.y.push(y);

        oos.logistico.p.push(predictLogistic(model, features[i] as number[]));
        oos.logistico.y.push(y);
      }
    }

    for (const key of Object.keys(oos)) {
      if (oos[key].p.length > 0) briers[key] = brierScore(oos[key].p, oos[key].y);
    }

    // Modello finale addestrato su tutto lo storico etichettabile.
    const finalModel = trainLogistic(
      labeled.map((i) => features[i] as number[]),
      labeled.map(labelOf),
    );
    const lastFeature = features[n - 1] ?? features[labeled[labeled.length - 1]];
    if (lastFeature) pLogistic = predictLogistic(finalModel, lastFeature);
  }

  // ---- Combinazione --------------------------------------------------------
  // Ogni stimatore porta con sé il proprio intervallo:
  //  - empirico: Wilson sul numero di finestre INDIPENDENTI (poche, quindi largo)
  //  - GBM: metodo delta sull'errore del drift, calcolato su tutti i rendimenti
  //  - logistico: nessuna forma chiusa; si usa l'ampiezza del GBM come proxy,
  //    dato che è stimato sullo stesso numero di osservazioni.
  const wilsonEmpirical = wilsonInterval(
    Math.round(pEmpirical * effectiveSamples),
    effectiveSamples,
  );
  const gbmCi = gbmInterval(driftDaily, volDaily, h, rets.length);
  const gbmHalfWidth = (gbmCi[1] - gbmCi[0]) / 2;

  const raw: {
    name: string;
    label: string;
    p: number;
    brier: number | null;
    ci: [number, number];
  }[] = [
    {
      name: "empirico",
      label: "Frequenza storica",
      p: pEmpirical,
      brier: briers.empirico,
      ci: wilsonEmpirical,
    },
    { name: "gbm", label: "Modello GBM", p: pGbm, brier: briers.gbm, ci: gbmCi },
  ];
  if (pLogistic !== null) {
    raw.push({
      name: "logistico",
      label: "Regressione logistica",
      p: pLogistic,
      brier: briers.logistico,
      ci: [clamp01(pLogistic - gbmHalfWidth), clamp01(pLogistic + gbmHalfWidth)],
    });
  }

  // Peso inversamente proporzionale all'errore fuori campione.
  // Se un Brier non è disponibile si usa 0.25 (quello di una previsione al 50%).
  const weightsRaw = raw.map((c) => 1 / ((c.brier ?? 0.25) + 0.02));
  const weightSum = weightsRaw.reduce((a, b) => a + b, 0);
  const components: ProbabilityComponent[] = raw.map((c, i) => ({
    name: c.name,
    label: c.label,
    pUp: c.p,
    weight: weightsRaw[i] / weightSum,
    brier: c.brier,
    ci95: c.ci,
  }));

  const pUp = clamp01(components.reduce((acc, c) => acc + c.pUp * c.weight, 0));

  // ---- Incertezza ----------------------------------------------------------
  // Errore di stima: media pesata degli intervalli dei singoli modelli.
  const lower = components.reduce((acc, c) => acc + c.ci95[0] * c.weight, 0);
  const upper = components.reduce((acc, c) => acc + c.ci95[1] * c.weight, 0);

  // Disaccordo fra modelli: è incertezza vera e va sommata, non ignorata.
  const spread =
    Math.max(...components.map((c) => c.pUp)) -
    Math.min(...components.map((c) => c.pUp));

  const ci95: [number, number] = [
    clamp01(Math.min(lower - spread / 2, pUp)),
    clamp01(Math.max(upper + spread / 2, pUp)),
  ];

  const sampleFactor = clamp01(rets.length / (10 * h));
  const widthFactor = clamp01(1 - (ci95[1] - ci95[0]));
  const agreementFactor = clamp01(1 - spread * 2);
  const confidence = clamp01(sampleFactor * 0.3 + widthFactor * 0.4 + agreementFactor * 0.3);

  return {
    pUp,
    pDown: 1 - pUp,
    ci95,
    confidence,
    horizonDays: h,
    effectiveSamples,
    components,
    expectedReturn,
    sigmaHorizon,
    driftDaily,
    volDaily,
    excessKurtosis: kurt,
    degraded: labeled.length < MIN_LABELED || empiricalTotal < 30,
  };
}

/** Punteggio di trend in [-1, 1]: posizione rispetto alle medie e alle bande. */
export function trendScore(closes: number[]): number {
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const { percentB } = bollinger(closes);
  const i = closes.length - 1;
  const parts: number[] = [];

  if (Number.isFinite(sma50[i]) && sma50[i] > 0) {
    parts.push(clamp((closes[i] / sma50[i] - 1) * 10, -1, 1));
  }
  if (Number.isFinite(sma200[i]) && sma200[i] > 0) {
    parts.push(clamp((closes[i] / sma200[i] - 1) * 5, -1, 1));
  }
  if (Number.isFinite(sma50[i]) && Number.isFinite(sma200[i]) && sma200[i] > 0) {
    parts.push(clamp((sma50[i] / sma200[i] - 1) * 10, -1, 1));
  }
  if (Number.isFinite(percentB[i])) {
    parts.push(clamp((percentB[i] - 0.5) * 2, -1, 1));
  }
  if (parts.length === 0) return 0;
  return parts.reduce((a, b) => a + b, 0) / parts.length;
}
