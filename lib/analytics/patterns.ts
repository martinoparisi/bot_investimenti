/**
 * Schemi grafici: la forma del grafico ridotta a numeri usabili dal modello.
 *
 * Doppi massimi, testa e spalle, triangoli, rotture di supporti e resistenze:
 * l'analisi tecnica classica descritta come sequenza di punti di svolta (pivot)
 * invece che a occhio.
 *
 * VINCOLO DI CAUSALITÀ — vale come per `indicators.ts`, ma qui è più insidioso.
 * Un massimo relativo si riconosce solo `k` barre DOPO che si è formato: prima
 * non si sa ancora che era un massimo. Perciò ogni pivot porta con sé
 * `confirmedAt = index + k` e tutte le serie sono indicizzate al momento della
 * conferma, mai a quello della formazione. Senza questa accortezza la
 * validazione walk-forward in `probability.ts` misurerebbe un Brier finto:
 * il modello starebbe leggendo il futuro.
 *
 * Nessuna serie restituisce `NaN`: `buildFeatures` scarta le righe che ne
 * contengono anche uno solo, e buttare via lo storico per l'assenza di uno
 * schema sarebbe il modo più stupido di perdere campione. Assenza di schema = 0,
 * assenza di supporto o resistenza = `FAR` (lontano).
 */

import type { Candle } from "../data/yahoo";
import { atr, bollinger, sma } from "./indicators";

export type PivotKind = "high" | "low";

export interface Pivot {
  index: number;
  price: number;
  kind: PivotKind;
  /** Barra in cui il pivot è riconoscibile: `index + k`. */
  confirmedAt: number;
}

export type PatternId =
  | "doubleTop"
  | "doubleBottom"
  | "headShoulders"
  | "invHeadShoulders"
  | "ascTriangle"
  | "descTriangle"
  | "symTriangle"
  | "breakoutUp"
  | "breakoutDown"
  | "squeeze";

export type PatternDirection = "bullish" | "bearish" | "neutral";

export const PATTERN_LABEL: Record<PatternId, string> = {
  doubleTop: "Doppio massimo",
  doubleBottom: "Doppio minimo",
  headShoulders: "Testa e spalle",
  invHeadShoulders: "Testa e spalle inverso",
  ascTriangle: "Triangolo ascendente",
  descTriangle: "Triangolo discendente",
  symTriangle: "Triangolo simmetrico",
  breakoutUp: "Rottura di resistenza",
  breakoutDown: "Rottura di supporto",
  squeeze: "Compressione di volatilità",
};

/** Cosa comporta ogni schema, in una riga. */
export const PATTERN_MEANING: Record<PatternId, string> = {
  doubleTop:
    "Il prezzo ha fallito due volte allo stesso livello: la spinta al rialzo si sta esaurendo. Sotto la neckline la figura diventa operativa, e l'obiettivo tipico è l'altezza dei due massimi proiettata verso il basso.",
  doubleBottom:
    "Due volte i venditori non sono riusciti ad andare più giù: il livello ha tenuto. Sopra la neckline la figura diventa operativa, e l'obiettivo tipico è la profondità dei due minimi proiettata verso l'alto.",
  headShoulders:
    "Un massimo alto fra due più bassi: chi compra non riesce più a superare i propri massimi. La rottura della neckline segna il passaggio del controllo ai venditori.",
  invHeadShoulders:
    "Un minimo profondo fra due meno profondi: la pressione in vendita si sta scaricando. Il superamento della neckline segna il passaggio del controllo ai compratori.",
  ascTriangle:
    "I minimi salgono contro una resistenza ferma: la domanda si accumula sotto un tetto. Si risolve più spesso con la rottura verso l'alto.",
  descTriangle:
    "I massimi scendono su un supporto fermo: l'offerta preme su un pavimento. Si risolve più spesso con la rottura verso il basso.",
  symTriangle:
    "Massimi che scendono e minimi che salgono: il mercato si comprime senza decidere. La direzione la dà la rottura, non la figura; qui viene ereditata dal trend in corso.",
  breakoutUp:
    "Il prezzo ha superato l'ultima resistenza: chi vendeva a quel livello ha smesso. Con volumi sopra la media la rottura regge più spesso, e il livello rotto diventa il primo supporto.",
  breakoutDown:
    "Il prezzo è sceso sotto l'ultimo supporto: il livello che reggeva ha ceduto. Con volumi sopra la media la rottura regge più spesso, e il livello rotto diventa la prima resistenza.",
  squeeze:
    "Le bande si sono strette: volatilità compressa, movimenti sempre più piccoli. Non dice dove andrà il prezzo, dice che sta per muoversi di più.",
};

export interface PatternEvent {
  id: PatternId;
  direction: PatternDirection;
  /** Quanto pesa, in [0,1]: uno schema confermato dalla rottura vale più di uno solo abbozzato. */
  strength: number;
  /** Barra in cui lo schema diventa noto. Mai quella in cui si è formato. */
  index: number;
  /** Livelli di prezzo dello schema: neckline, resistenza, supporto. */
  levels: { label: string; price: number }[];
  pivots: { index: number; price: number; kind: PivotKind }[];
}

export interface PatternFeatures {
  /** Struttura di Dow: massimi e minimi crescenti = +1, decrescenti = -1. */
  structure: number[];
  /** Sintesi degli schemi attivi, in [-1,1]. */
  pattern: number[];
  /** Distanza dalla resistenza più vicina, in ATR. `FAR` se non ce n'è una sopra. */
  distResistance: number[];
  /** Distanza dal supporto più vicino, in ATR. */
  distSupport: number[];
  /** Pendenza del canale a 60 barre, come rendimento log annualizzato. */
  channelSlope: number[];
  /** R² della stessa regressione: quanto il prezzo segue davvero un canale. */
  channelR2: number[];
}

export interface PatternAnalysis extends PatternFeatures {
  events: PatternEvent[];
}

export interface DetectedPattern {
  id: PatternId;
  label: string;
  /** Cosa comporta: viaggia nella risposta invece di importare questo modulo nel browser. */
  meaning: string;
  direction: PatternDirection;
  strength: number;
  /** Sedute passate dalla conferma. */
  ageBars: number;
  /** Istante (epoch secondi) della barra di conferma. */
  detectedAt: number;
  levels: { label: string; price: number }[];
  pivots: { time: number; price: number; kind: PivotKind }[];
}

/** Barre di conferma di un pivot: massimo/minimo su una finestra di ±k. */
const PIVOT_K = 5;
/** Oltre queste barre uno schema è considerato esaurito. */
const MAX_AGE = 60;
/** Costante di decadimento del peso di uno schema, in barre. */
const DECAY = 20;
/** Distanza "irrilevante" da un livello, in ATR: usata anche quando il livello manca. */
const FAR = 6;
/** Finestra della regressione di canale. */
const CHANNEL_WINDOW = 60;

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/**
 * Punti di svolta. `highs[i]` è un massimo se supera tutte le barre in [i-k, i+k];
 * il valore è utilizzabile solo da `i + k` in poi.
 */
export function pivots(highs: number[], lows: number[], k = PIVOT_K): Pivot[] {
  const out: Pivot[] = [];
  for (let i = k; i < highs.length - k; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (highs[j] >= highs[i]) isHigh = false;
      if (lows[j] <= lows[i]) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) out.push({ index: i, price: highs[i], kind: "high", confirmedAt: i + k });
    if (isLow) out.push({ index: i, price: lows[i], kind: "low", confirmedAt: i + k });
  }
  return out;
}

/** Minimo delle barre fra due indici (estremi esclusi). */
function lowestBetween(lows: number[], from: number, to: number): number {
  let min = Infinity;
  for (let i = from + 1; i < to; i++) min = Math.min(min, lows[i]);
  return Number.isFinite(min) ? min : lows[from];
}

/** Massimo delle barre fra due indici (estremi esclusi). */
function highestBetween(highs: number[], from: number, to: number): number {
  let max = -Infinity;
  for (let i = from + 1; i < to; i++) max = Math.max(max, highs[i]);
  return Number.isFinite(max) ? max : highs[from];
}

/**
 * Regressione lineare scorrevole del log-prezzo su `CHANNEL_WINDOW` barre.
 * Somme incrementali: O(n) invece di O(n·W).
 */
function channelSeries(closes: number[]): { slope: number[]; r2: number[] } {
  const n = closes.length;
  const w = CHANNEL_WINDOW;
  const slope = new Array<number>(n).fill(0);
  const r2 = new Array<number>(n).fill(0);
  if (n < w) return { slope, r2 };

  let sx = 0;
  let sxx = 0;
  let sy = 0;
  let sxy = 0;
  let syy = 0;

  const y = closes.map((c) => (c > 0 ? Math.log(c) : 0));

  for (let i = 0; i < n; i++) {
    sx += i;
    sxx += i * i;
    sy += y[i];
    sxy += i * y[i];
    syy += y[i] * y[i];

    if (i >= w) {
      const j = i - w;
      sx -= j;
      sxx -= j * j;
      sy -= y[j];
      sxy -= j * y[j];
      syy -= y[j] * y[j];
    }
    if (i < w - 1) continue;

    const denom = w * sxx - sx * sx;
    if (denom <= 0) continue;
    const b = (w * sxy - sx * sy) / denom;
    const ssTot = syy - (sy * sy) / w;
    const ssReg = b * (sxy - (sx * sy) / w);

    // 252 sedute: la pendenza diventa un rendimento log annualizzato, leggibile.
    slope[i] = clamp(b * 252, -1.5, 1.5);
    r2[i] = ssTot > 0 ? clamp(ssReg / ssTot, 0, 1) : 0;
  }
  return { slope, r2 };
}

/**
 * Rileva gli schemi e ne ricava le feature per barra.
 *
 * Tutto in una sola passata in avanti: a ogni barra si aggiungono i pivot appena
 * confermati, si controlla se completano una figura, e si verifica se una figura
 * in attesa è stata confermata dalla rottura del suo livello.
 */
export function patternAnalysis(
  highs: number[],
  lows: number[],
  closes: number[],
  volumes: number[] = [],
  k = PIVOT_K,
): PatternAnalysis {
  const n = closes.length;
  const events: PatternEvent[] = [];
  const structure = new Array<number>(n).fill(0);
  const pattern = new Array<number>(n).fill(0);
  const distResistance = new Array<number>(n).fill(FAR);
  const distSupport = new Array<number>(n).fill(FAR);

  const { slope: channelSlope, r2: channelR2 } = channelSeries(closes);
  if (n === 0) {
    return { structure, pattern, distResistance, distSupport, channelSlope, channelR2, events };
  }

  const atrSeries = atr(highs, lows, closes, 14);
  const { upper, lower, middle } = bollinger(closes, 20);
  const volAvg = volumes.length === n ? sma(volumes, 20) : new Array<number>(n).fill(NaN);

  // Media esponenziale dell'ampiezza delle bande: riferimento per la compressione.
  // Un percentile scorrevole sarebbe più preciso ma costa O(n·252) per titolo, e
  // qui i titoli sono centinaia.
  const bandwidth = new Array<number>(n).fill(NaN);
  const bandwidthAvg = new Array<number>(n).fill(NaN);
  const emaK = 2 / (100 + 1);
  let bwPrev = NaN;
  for (let i = 0; i < n; i++) {
    if (!(middle[i] > 0) || !Number.isFinite(upper[i])) continue;
    bandwidth[i] = (upper[i] - lower[i]) / middle[i];
    bwPrev = Number.isFinite(bwPrev) ? bandwidth[i] * emaK + bwPrev * (1 - emaK) : bandwidth[i];
    bandwidthAvg[i] = bwPrev;
  }

  const byConfirm = new Map<number, Pivot[]>();
  for (const p of pivots(highs, lows, k)) {
    const list = byConfirm.get(p.confirmedAt);
    if (list) list.push(p);
    else byConfirm.set(p.confirmedAt, [p]);
  }

  /** Figure in attesa della rottura che le conferma. */
  interface Pending {
    id: PatternId;
    direction: PatternDirection;
    /** Livello la cui rottura conferma la figura. */
    neckline: number;
    expiresAt: number;
    levels: { label: string; price: number }[];
    pivots: PatternEvent["pivots"];
  }

  const highPivots: Pivot[] = [];
  const lowPivots: Pivot[] = [];
  let pendings: Pending[] = [];
  const lastEmitted = new Map<PatternId, number>();

  const atrAt = (i: number): number => {
    const a = atrSeries[i];
    return Number.isFinite(a) && a > 0 ? a : Math.max(closes[i] * 0.02, Number.EPSILON);
  };

  /** Evita che la stessa figura si ripeta a ogni pivot mentre è ancora la stessa. */
  const emit = (event: PatternEvent, cooldown = 20): boolean => {
    const last = lastEmitted.get(event.id);
    if (last !== undefined && event.index - last < cooldown) return false;
    lastEmitted.set(event.id, event.index);
    events.push(event);
    return true;
  };

  const asPivots = (list: Pivot[]) =>
    list.map((p) => ({ index: p.index, price: p.price, kind: p.kind }));

  for (let i = 0; i < n; i++) {
    const tol = 1.5 * atrAt(i);
    const confirmed = byConfirm.get(i);

    if (confirmed) {
      for (const p of confirmed) {
        (p.kind === "high" ? highPivots : lowPivots).push(p);
      }

      // ---- Doppio massimo / doppio minimo -------------------------------
      for (const kind of confirmed.map((p) => p.kind)) {
        const list = kind === "high" ? highPivots : lowPivots;
        if (list.length < 2) continue;
        const a = list[list.length - 2];
        const b = list[list.length - 1];
        const gap = b.index - a.index;
        if (Math.abs(a.price - b.price) > tol || gap < 10 || gap > 90) continue;

        const bearish = kind === "high";
        const neckline = bearish
          ? lowestBetween(lows, a.index, b.index)
          : highestBetween(highs, a.index, b.index);
        const id: PatternId = bearish ? "doubleTop" : "doubleBottom";
        const levels = [
          { label: "Neckline", price: neckline },
          { label: bearish ? "Doppio massimo" : "Doppio minimo", price: (a.price + b.price) / 2 },
        ];
        const shape = asPivots([a, b]);
        if (emit({
          id,
          direction: bearish ? "bearish" : "bullish",
          strength: 0.4,
          index: i,
          levels,
          pivots: shape,
        })) {
          pendings.push({
            id,
            direction: bearish ? "bearish" : "bullish",
            neckline,
            expiresAt: i + MAX_AGE,
            levels,
            pivots: shape,
          });
        }
      }

      // ---- Testa e spalle (e inverso) ------------------------------------
      for (const kind of confirmed.map((p) => p.kind)) {
        const list = kind === "high" ? highPivots : lowPivots;
        if (list.length < 3) continue;
        const [a, b, c] = list.slice(-3);
        const bearish = kind === "high";

        const headStandsOut = bearish
          ? b.price > a.price + tol && b.price > c.price + tol
          : b.price < a.price - tol && b.price < c.price - tol;
        const shouldersAligned = Math.abs(a.price - c.price) <= 1.5 * tol;
        if (!headStandsOut || !shouldersAligned) continue;

        const neckline = bearish
          ? (lowestBetween(lows, a.index, b.index) + lowestBetween(lows, b.index, c.index)) / 2
          : (highestBetween(highs, a.index, b.index) + highestBetween(highs, b.index, c.index)) / 2;
        const id: PatternId = bearish ? "headShoulders" : "invHeadShoulders";
        const levels = [
          { label: "Neckline", price: neckline },
          { label: "Testa", price: b.price },
        ];
        const shape = asPivots([a, b, c]);
        if (emit({
          id,
          direction: bearish ? "bearish" : "bullish",
          strength: 0.5,
          index: i,
          levels,
          pivots: shape,
        })) {
          pendings.push({
            id,
            direction: bearish ? "bearish" : "bullish",
            neckline,
            expiresAt: i + MAX_AGE,
            levels,
            pivots: shape,
          });
        }
      }

      // ---- Triangoli -------------------------------------------------------
      if (highPivots.length >= 3 && lowPivots.length >= 3) {
        const h1 = highPivots[highPivots.length - 3];
        const h3 = highPivots[highPivots.length - 1];
        const l1 = lowPivots[lowPivots.length - 3];
        const l3 = lowPivots[lowPivots.length - 1];
        const span = i - Math.min(h1.index, l1.index);

        if (span <= 120) {
          const flatHighs = Math.abs(h3.price - h1.price) <= tol;
          const flatLows = Math.abs(l3.price - l1.price) <= tol;
          const fallingHighs = h3.price < h1.price - tol;
          const risingLows = l3.price > l1.price + tol;
          const shape = asPivots([h1, h3, l1, l3]);
          const levels = [
            { label: "Resistenza", price: Math.max(h1.price, h3.price) },
            { label: "Supporto", price: Math.min(l1.price, l3.price) },
          ];

          if (flatHighs && risingLows) {
            emit({ id: "ascTriangle", direction: "bullish", strength: 0.45, index: i, levels, pivots: shape });
          } else if (flatLows && fallingHighs) {
            emit({ id: "descTriangle", direction: "bearish", strength: 0.45, index: i, levels, pivots: shape });
          } else if (fallingHighs && risingLows) {
            // Simmetrico: non dice la direzione, la eredita dal trend in corso.
            const bias = channelSlope[i];
            emit({
              id: "symTriangle",
              direction: Math.abs(bias) < 0.05 ? "neutral" : bias > 0 ? "bullish" : "bearish",
              strength: 0.25,
              index: i,
              levels,
              pivots: shape,
            });
          }
        }
      }
    }

    // ---- Conferma delle figure in attesa ---------------------------------
    if (pendings.length > 0) {
      const survivors: Pending[] = [];
      for (const p of pendings) {
        if (i > p.expiresAt) continue;
        const broken =
          p.direction === "bearish" ? closes[i] < p.neckline : closes[i] > p.neckline;
        if (broken) {
          // La rottura della neckline è ciò che rende la figura operativa: da qui
          // il peso quasi raddoppia.
          events.push({ ...p, strength: 0.9, index: i });
          lastEmitted.set(p.id, i);
          continue;
        }
        survivors.push(p);
      }
      pendings = survivors;
    }

    // ---- Distanza da supporto e resistenza -------------------------------
    const atrNow = atrAt(i);
    let resistance = Infinity;
    for (let j = highPivots.length - 1; j >= 0 && i - highPivots[j].index <= 252; j--) {
      if (highPivots[j].price > closes[i]) resistance = Math.min(resistance, highPivots[j].price);
    }
    let support = -Infinity;
    for (let j = lowPivots.length - 1; j >= 0 && i - lowPivots[j].index <= 252; j--) {
      if (lowPivots[j].price < closes[i]) support = Math.max(support, lowPivots[j].price);
    }
    distResistance[i] = Number.isFinite(resistance)
      ? clamp((resistance - closes[i]) / atrNow, 0, FAR)
      : FAR;
    distSupport[i] = Number.isFinite(support)
      ? clamp((closes[i] - support) / atrNow, 0, FAR)
      : FAR;

    // ---- Rotture ---------------------------------------------------------
    if (i > 0) {
      const relVolume = volAvg[i] > 0 ? volumes[i] / volAvg[i] : 1;
      const volumeBoost = 0.5 + 0.4 * clamp(relVolume - 1, 0, 1);

      if (highPivots.length >= 3) {
        const level = Math.max(...highPivots.slice(-3).map((p) => p.price));
        const threshold = level + 0.25 * atrNow;
        if (closes[i] > threshold && closes[i - 1] <= threshold) {
          emit(
            {
              id: "breakoutUp",
              direction: "bullish",
              strength: volumeBoost,
              index: i,
              levels: [{ label: "Resistenza rotta", price: level }],
              pivots: asPivots(highPivots.slice(-3)),
            },
            5,
          );
        }
      }
      if (lowPivots.length >= 3) {
        const level = Math.min(...lowPivots.slice(-3).map((p) => p.price));
        const threshold = level - 0.25 * atrNow;
        if (closes[i] < threshold && closes[i - 1] >= threshold) {
          emit(
            {
              id: "breakoutDown",
              direction: "bearish",
              strength: volumeBoost,
              index: i,
              levels: [{ label: "Supporto rotto", price: level }],
              pivots: asPivots(lowPivots.slice(-3)),
            },
            5,
          );
        }
      }
    }

    // ---- Compressione di volatilità --------------------------------------
    if (
      Number.isFinite(bandwidth[i]) &&
      Number.isFinite(bandwidthAvg[i]) &&
      bandwidth[i] < 0.6 * bandwidthAvg[i]
    ) {
      const bias = channelSlope[i];
      emit({
        id: "squeeze",
        direction: Math.abs(bias) < 0.05 ? "neutral" : bias > 0 ? "bullish" : "bearish",
        strength: 0.2,
        index: i,
        levels: [
          { label: "Banda superiore", price: upper[i] },
          { label: "Banda inferiore", price: lower[i] },
        ],
        pivots: [],
      });
    }

    // ---- Struttura di Dow -------------------------------------------------
    const parts: number[] = [];
    if (highPivots.length >= 2) {
      const [a, b] = highPivots.slice(-2);
      parts.push(Math.sign(b.price - a.price));
    }
    if (lowPivots.length >= 2) {
      const [a, b] = lowPivots.slice(-2);
      parts.push(Math.sign(b.price - a.price));
    }
    structure[i] = parts.length ? parts.reduce((x, y) => x + y, 0) / parts.length : 0;
  }

  // ---- Sintesi per barra: schemi attivi con peso che decade ---------------
  let ptr = 0;
  const active: PatternEvent[] = [];
  for (let i = 0; i < n; i++) {
    while (ptr < events.length && events[ptr].index <= i) active.push(events[ptr++]);
    while (active.length > 0 && i - active[0].index > MAX_AGE) active.shift();

    let score = 0;
    for (const e of active) {
      const sign = e.direction === "bullish" ? 1 : e.direction === "bearish" ? -1 : 0;
      score += sign * e.strength * Math.exp(-(i - e.index) / DECAY);
    }
    pattern[i] = clamp(score, -1, 1);
  }

  return { structure, pattern, distResistance, distSupport, channelSlope, channelR2, events };
}

/** Schemi ancora in vigore alla fine della serie, pronti da mostrare. */
export function detectPatterns(candles: Candle[], analysis?: PatternAnalysis): DetectedPattern[] {
  if (candles.length === 0) return [];
  const result =
    analysis ??
    patternAnalysis(
      candles.map((c) => c.high),
      candles.map((c) => c.low),
      candles.map((c) => c.close),
      candles.map((c) => c.volume),
    );

  const lastIndex = candles.length - 1;
  // Un solo schema per tipo: quello confermato più di recente, che è anche il
  // più forte (la conferma della rottura sostituisce la figura abbozzata).
  const best = new Map<PatternId, PatternEvent>();
  for (const e of result.events) {
    if (lastIndex - e.index > MAX_AGE) continue;
    const current = best.get(e.id);
    if (!current || e.index >= current.index) best.set(e.id, e);
  }

  return Array.from(best.values())
    .map((e) => ({
      id: e.id,
      label: PATTERN_LABEL[e.id],
      meaning: PATTERN_MEANING[e.id],
      direction: e.direction,
      strength: e.strength,
      ageBars: lastIndex - e.index,
      detectedAt: candles[e.index]?.time ?? candles[lastIndex].time,
      levels: e.levels,
      pivots: e.pivots.map((p) => ({
        time: candles[p.index]?.time ?? candles[lastIndex].time,
        price: p.price,
        kind: p.kind,
      })),
    }))
    // Dal più recente al più vecchio; a parità di seduta vince il più forte.
    .sort((a, b) => a.ageBars - b.ageBars || b.strength - a.strength);
}
