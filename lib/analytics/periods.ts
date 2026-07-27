/**
 * Definizione dei periodi selezionabili.
 *
 * Ogni periodo ha due ruoli distinti che è importante non confondere:
 *  - `chartRange` / `chartInterval`: cosa mostra il GRAFICO.
 *  - `lookbackDays` / `horizonDays`: cosa usa l'ANALISI statistica.
 *
 * L'analisi lavora sempre su chiusure giornaliere e usa una finestra storica
 * più lunga del periodo mostrato: stimare volatilità e drift su 5 barre non ha
 * senso statistico. La probabilità restituita è invece riferita ai prossimi
 * `horizonDays` giorni di borsa, cioè alla stessa ampiezza del periodo scelto.
 */

export const PERIOD_IDS = [
  "1d",
  "1w",
  "1m",
  "3m",
  "6m",
  "ytd",
  "1y",
  "3y",
  "5y",
  "max",
] as const;

export type PeriodId = (typeof PERIOD_IDS)[number];

export interface PeriodDef {
  id: PeriodId;
  label: string;
  /** Range da passare all'endpoint chart di Yahoo. */
  chartRange: string;
  /** Intervallo barre del grafico. */
  chartInterval: string;
  /** Giorni di borsa di storico giornaliero usati per stimare i parametri. */
  lookbackDays: number;
  /** Orizzonte previsivo in giorni di borsa. `null` = calcolato a runtime (YTD). */
  horizonDays: number | null;
}

export const PERIODS: Record<PeriodId, PeriodDef> = {
  "1d": { id: "1d", label: "1 giorno", chartRange: "1d", chartInterval: "5m", lookbackDays: 252, horizonDays: 1 },
  "1w": { id: "1w", label: "1 settimana", chartRange: "5d", chartInterval: "15m", lookbackDays: 252, horizonDays: 5 },
  "1m": { id: "1m", label: "1 mese", chartRange: "1mo", chartInterval: "60m", lookbackDays: 504, horizonDays: 21 },
  "3m": { id: "3m", label: "3 mesi", chartRange: "3mo", chartInterval: "1d", lookbackDays: 756, horizonDays: 63 },
  "6m": { id: "6m", label: "6 mesi", chartRange: "6mo", chartInterval: "1d", lookbackDays: 1260, horizonDays: 126 },
  ytd: { id: "ytd", label: "YTD", chartRange: "ytd", chartInterval: "1d", lookbackDays: 1260, horizonDays: null },
  "1y": { id: "1y", label: "1 anno", chartRange: "1y", chartInterval: "1d", lookbackDays: 1260, horizonDays: 252 },
  "3y": { id: "3y", label: "3 anni", chartRange: "3y", chartInterval: "1wk", lookbackDays: 2520, horizonDays: 756 },
  "5y": { id: "5y", label: "5 anni", chartRange: "5y", chartInterval: "1wk", lookbackDays: 3780, horizonDays: 1260 },
  max: { id: "max", label: "Tutto", chartRange: "max", chartInterval: "1mo", lookbackDays: 100000, horizonDays: 1260 },
};

export function isPeriodId(value: unknown): value is PeriodId {
  return typeof value === "string" && (PERIOD_IDS as readonly string[]).includes(value);
}

export function parsePeriod(value: unknown, fallback: PeriodId = "1m"): PeriodId {
  return isPeriodId(value) ? value : fallback;
}

/** Giorni di borsa rimanenti nell'anno solare corrente (min 1). */
export function tradingDaysLeftInYear(now = new Date()): number {
  const endOfYear = new Date(Date.UTC(now.getUTCFullYear(), 11, 31));
  const calendarDays = Math.max(
    0,
    Math.round((endOfYear.getTime() - now.getTime()) / 86_400_000),
  );
  return Math.max(1, Math.round(calendarDays * (252 / 365)));
}

/** Orizzonte effettivo in giorni di borsa per il periodo scelto. */
export function horizonFor(period: PeriodId, now = new Date()): number {
  return PERIODS[period].horizonDays ?? tradingDaysLeftInYear(now);
}
