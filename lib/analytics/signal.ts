/**
 * Da probabilità e rischio a tre percentuali: Compra / Vendi / Mantieni.
 *
 * Non è una soglia secca ma una softmax su tre utilità. Il vantaggio pratico è
 * che l'incertezza ha un posto esplicito: quando `confidence` è bassa l'utilità
 * di "Mantieni" cresce e le tre percentuali si appiattiscono, invece di dare un
 * consiglio netto basato su dati che non lo sostengono.
 */

export interface SignalInput {
  /** Probabilità di salita sull'orizzonte scelto, in [0,1]. */
  pUp: number;
  /** Affidabilità della stima, in [0,1]. */
  confidence: number;
  /** Rendimento atteso sull'orizzonte (semplice). */
  expectedReturn: number;
  /** Deviazione standard del rendimento sull'orizzonte. */
  sigmaHorizon: number;
  /** Punteggio di trend in [-1,1]. */
  trend: number;
  /** Sintesi degli schemi grafici attivi in [-1,1]. Assente = nessuno schema. */
  patternScore?: number;
  /** RSI a 14 periodi, 0-100. `null` se non calcolabile. */
  rsi: number | null;
  /** Expected shortfall giornaliero al 95%, valore negativo. */
  cvar95: number;
  /** Massimo drawdown storico, valore negativo. */
  maxDrawdown: number;
}

export type Verdict = "buy" | "sell" | "keep";

export interface SignalResult {
  /** Percentuali intere che sommano esattamente a 100. */
  buy: number;
  sell: number;
  keep: number;
  verdict: Verdict;
  /** Distanza fra la percentuale vincente e la seconda: quanto è netto. */
  conviction: number;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Arrotondamento a interi con metodo dei resti massimi: la somma resta 100. */
function toPercentages(values: number[]): number[] {
  const scaled = values.map((v) => v * 100);
  const floored = scaled.map(Math.floor);
  let remainder = 100 - floored.reduce((a, b) => a + b, 0);
  const order = scaled
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  const out = [...floored];
  for (let k = 0; k < order.length && remainder > 0; k++, remainder--) {
    out[order[k].i]++;
  }
  return out;
}

export function computeSignal(input: SignalInput): SignalResult {
  const edge = clamp(input.pUp - 0.5, -0.5, 0.5);

  // Rendimento atteso per unità di rischio sull'orizzonte.
  const riskAdjusted = clamp(
    input.sigmaHorizon > 0 ? input.expectedReturn / input.sigmaHorizon : 0,
    -2,
    2,
  );

  const rsiValue = input.rsi ?? 50;
  const oversold = rsiValue < 30 ? (30 - rsiValue) / 30 : 0;
  const overbought = rsiValue > 70 ? (rsiValue - 70) / 30 : 0;

  // |CVaR| giornaliero: 2% al giorno è già una coda pesante, normalizziamo lì.
  const tailRisk = clamp(Math.abs(input.cvar95) / 0.02, 0, 2);
  const drawdownRisk = clamp(Math.abs(input.maxDrawdown) / 0.5, 0, 1.5);

  // Gli schemi grafici pesano già dentro `pUp` come feature della logistica; qui
  // entrano una seconda volta, con peso deliberatamente più basso di `trend`,
  // perché una rottura netta deve vedersi nel consiglio anche quando la
  // probabilità si muove poco.
  const pattern = clamp(input.patternScore ?? 0, -1, 1);

  const uBuy =
    6 * edge + 0.8 * riskAdjusted + 1.0 * input.trend + 0.6 * oversold + 0.8 * pattern;
  const uSell =
    -6 * edge -
    0.8 * riskAdjusted -
    1.0 * input.trend -
    0.8 * pattern +
    0.6 * overbought +
    0.5 * tailRisk +
    0.3 * drawdownRisk;
  const uKeep = 0.8 + 2.5 * (1 - clamp(input.confidence, 0, 1));

  const utilities = [uBuy, uSell, uKeep];
  const maxU = Math.max(...utilities);
  const exps = utilities.map((u) => Math.exp(u - maxU));
  const total = exps.reduce((a, b) => a + b, 0);
  const probs = exps.map((e) => e / total);

  const [buy, sell, keep] = toPercentages(probs);
  const sorted = [buy, sell, keep].sort((a, b) => b - a);
  const verdict: Verdict = buy === sorted[0] ? "buy" : sell === sorted[0] ? "sell" : "keep";

  return { buy, sell, keep, verdict, conviction: sorted[0] - sorted[1] };
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  buy: "Compra",
  sell: "Vendi",
  keep: "Mantieni",
};

/** Media di più segnali pesata per controvalore (usata dal portafoglio). */
export function aggregateSignals(
  items: { signal: SignalResult; weight: number }[],
): SignalResult {
  const totalWeight = items.reduce((a, b) => a + b.weight, 0);
  if (totalWeight <= 0) {
    return { buy: 0, sell: 0, keep: 100, verdict: "keep", conviction: 100 };
  }
  const acc = items.reduce(
    (a, { signal, weight }) => ({
      buy: a.buy + (signal.buy * weight) / totalWeight,
      sell: a.sell + (signal.sell * weight) / totalWeight,
      keep: a.keep + (signal.keep * weight) / totalWeight,
    }),
    { buy: 0, sell: 0, keep: 0 },
  );
  const [buy, sell, keep] = toPercentages([acc.buy / 100, acc.sell / 100, acc.keep / 100]);
  const sorted = [buy, sell, keep].sort((a, b) => b - a);
  const verdict: Verdict = buy === sorted[0] ? "buy" : sell === sorted[0] ? "sell" : "keep";
  return { buy, sell, keep, verdict, conviction: sorted[0] - sorted[1] };
}
