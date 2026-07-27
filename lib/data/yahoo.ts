/**
 * Accesso ai dati Yahoo Finance.
 *
 * Due strade diverse, per un motivo preciso:
 *  - `chart` e `search` vengono chiamati con `fetch` diretto: sono endpoint
 *    pubblici che rispondono senza autenticazione (verificato).
 *  - `quote` passa da `yahoo-finance2` perché dal 2024 richiede cookie + crumb
 *    e senza libreria risponde 401.
 *
 * Nessuna chiave API è necessaria per questo modulo.
 */

const CHART_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";
const SEARCH_BASE = "https://query2.finance.yahoo.com/v1/finance/search";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export interface Candle {
  time: number; // secondi epoch
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ChartMeta {
  symbol: string;
  currency: string;
  exchangeName: string;
  fullExchangeName: string;
  instrumentType: string;
  timezone: string;
  regularMarketPrice: number;
  previousClose: number;
  regularMarketTime: number;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  regularMarketDayHigh: number | null;
  regularMarketDayLow: number | null;
  regularMarketVolume: number | null;
  longName: string | null;
  /** true se l'ultimo prezzo è più vecchio di 3 minuti (dato ritardato). */
  delayed: boolean;
}

export interface ChartResult {
  meta: ChartMeta;
  candles: Candle[];
}

// ---------------------------------------------------------------------------
// Limitatore di concorrenza (evita di martellare Yahoo con 750 richieste)
// ---------------------------------------------------------------------------

export function createLimiter(concurrency: number) {
  let active = 0;
  const queue: (() => void)[] = [];

  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= concurrency) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active++;
    try {
      return await task();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}

const limit = createLimiter(5);

async function fetchWithRetry(url: string, revalidate: number, attempts = 3): Promise<Response> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        next: { revalidate },
      });
      if (res.ok) return res;
      // 404 = simbolo inesistente: riprovare non serve a niente.
      if (res.status === 404) throw new Error(`HTTP 404 su ${url}`);
      lastError = new Error(`HTTP ${res.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((r) => setTimeout(r, 250 * 2 ** i));
  }
  throw lastError instanceof Error ? lastError : new Error("richiesta fallita");
}

// ---------------------------------------------------------------------------
// Chart
// ---------------------------------------------------------------------------

interface RawChart {
  chart: {
    result?: {
      meta: Record<string, unknown>;
      timestamp?: number[];
      indicators: {
        quote: {
          open?: (number | null)[];
          high?: (number | null)[];
          low?: (number | null)[];
          close?: (number | null)[];
          volume?: (number | null)[];
        }[];
      };
    }[];
    error?: { code: string; description: string } | null;
  };
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function numOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseChart(raw: RawChart): ChartResult {
  const result = raw.chart.result?.[0];
  if (!result) {
    throw new Error(raw.chart.error?.description ?? "nessun dato restituito");
  }
  const meta = result.meta;
  const q = result.indicators.quote[0] ?? {};
  const timestamps = result.timestamp ?? [];

  const candles: Candle[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = q.close?.[i];
    if (close === null || close === undefined || !Number.isFinite(close)) continue;
    candles.push({
      time: timestamps[i],
      open: num(q.open?.[i], close),
      high: num(q.high?.[i], close),
      low: num(q.low?.[i], close),
      close,
      volume: num(q.volume?.[i], 0),
    });
  }

  const marketTime = num(meta.regularMarketTime);
  return {
    meta: {
      symbol: String(meta.symbol ?? ""),
      currency: String(meta.currency ?? ""),
      exchangeName: String(meta.exchangeName ?? ""),
      fullExchangeName: String(meta.fullExchangeName ?? meta.exchangeName ?? ""),
      instrumentType: String(meta.instrumentType ?? "EQUITY"),
      timezone: String(meta.exchangeTimezoneName ?? "UTC"),
      regularMarketPrice: num(meta.regularMarketPrice, candles.at(-1)?.close ?? 0),
      previousClose: num(meta.chartPreviousClose, num(meta.previousClose)),
      regularMarketTime: marketTime,
      fiftyTwoWeekHigh: numOrNull(meta.fiftyTwoWeekHigh),
      fiftyTwoWeekLow: numOrNull(meta.fiftyTwoWeekLow),
      regularMarketDayHigh: numOrNull(meta.regularMarketDayHigh),
      regularMarketDayLow: numOrNull(meta.regularMarketDayLow),
      regularMarketVolume: numOrNull(meta.regularMarketVolume),
      longName: (meta.longName as string) ?? (meta.shortName as string) ?? null,
      delayed: marketTime > 0 && Date.now() / 1000 - marketTime > 180,
    },
    candles,
  };
}

/** Serie per il grafico: range e intervallo nel formato Yahoo. */
export async function fetchChart(
  symbol: string,
  range: string,
  interval: string,
  revalidate = 30,
): Promise<ChartResult> {
  const url = `${CHART_BASE}/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`;
  const res = await limit(() => fetchWithRetry(url, revalidate));
  return parseChart((await res.json()) as RawChart);
}

/**
 * Chiusure giornaliere per l'analisi statistica.
 * `days` è in giorni di borsa; il range richiesto è più ampio per coprire
 * weekend e festivi.
 */
export async function fetchDailyHistory(
  symbol: string,
  days: number,
  revalidate = 900,
): Promise<ChartResult> {
  const range =
    days >= 5000 ? "max" : days >= 3000 ? "20y" : days >= 2000 ? "10y" : days >= 1000 ? "5y" : days >= 500 ? "2y" : "1y";
  const url = `${CHART_BASE}/${encodeURIComponent(symbol)}?range=${range}&interval=1d`;
  const res = await limit(() => fetchWithRetry(url, revalidate));
  const parsed = parseChart((await res.json()) as RawChart);
  if (parsed.candles.length > days) {
    parsed.candles = parsed.candles.slice(-days);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Ricerca
// ---------------------------------------------------------------------------

export interface SearchHit {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
  sector: string | null;
}

interface RawSearch {
  quotes?: {
    symbol?: string;
    shortname?: string;
    longname?: string;
    exchDisp?: string;
    exchange?: string;
    quoteType?: string;
    typeDisp?: string;
    sector?: string;
    isYahooFinance?: boolean;
  }[];
}

/** Accetta ticker, nome societario e anche ISIN (Yahoo li risolve). */
export async function searchSymbols(query: string, limitResults = 12): Promise<SearchHit[]> {
  const url = `${SEARCH_BASE}?q=${encodeURIComponent(query)}&quotesCount=${limitResults}&newsCount=0&listsCount=0`;
  const res = await limit(() => fetchWithRetry(url, 300));
  const json = (await res.json()) as RawSearch;
  return (json.quotes ?? [])
    .filter((q) => q.isYahooFinance !== false && q.symbol)
    .map((q) => ({
      symbol: q.symbol as string,
      name: q.longname ?? q.shortname ?? (q.symbol as string),
      exchange: q.exchDisp ?? q.exchange ?? "",
      type: q.typeDisp ?? q.quoteType ?? "",
      sector: q.sector ?? null,
    }));
}

// ---------------------------------------------------------------------------
// Quote (via yahoo-finance2: serve il crumb)
// ---------------------------------------------------------------------------

export interface QuoteData {
  symbol: string;
  price: number | null;
  previousClose: number | null;
  changePercent: number | null;
  currency: string | null;
  marketState: string | null;
  bid: number | null;
  ask: number | null;
  bidSize: number | null;
  askSize: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  open: number | null;
  volume: number | null;
  averageVolume: number | null;
  marketCap: number | null;
  trailingPE: number | null;
  forwardPE: number | null;
  dividendYield: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  shortName: string | null;
  longName: string | null;
  exchange: string | null;
}

type YahooClient = {
  quote: (symbols: string[]) => Promise<Record<string, unknown>[]>;
};

let yahooClient: YahooClient | null = null;

/**
 * Istanza condivisa di yahoo-finance2 v4 (richiede `new`).
 * La validazione dello schema è silenziata: Yahoo aggiunge campi non
 * documentati di continuo e non è un buon motivo per far fallire una richiesta.
 */
async function getYahoo(): Promise<YahooClient> {
  if (!yahooClient) {
    const { default: YahooFinance } = await import("yahoo-finance2");
    yahooClient = new YahooFinance({
      suppressNotices: ["yahooSurvey"],
      validation: { logErrors: false, logOptionsErrors: false },
    }) as unknown as YahooClient;
  }
  return yahooClient;
}

function mapQuote(raw: Record<string, unknown>): QuoteData {
  return {
    symbol: String(raw.symbol ?? ""),
    price: numOrNull(raw.regularMarketPrice),
    previousClose: numOrNull(raw.regularMarketPreviousClose),
    changePercent: numOrNull(raw.regularMarketChangePercent),
    currency: (raw.currency as string) ?? null,
    marketState: (raw.marketState as string) ?? null,
    bid: numOrNull(raw.bid),
    ask: numOrNull(raw.ask),
    bidSize: numOrNull(raw.bidSize),
    askSize: numOrNull(raw.askSize),
    dayHigh: numOrNull(raw.regularMarketDayHigh),
    dayLow: numOrNull(raw.regularMarketDayLow),
    open: numOrNull(raw.regularMarketOpen),
    volume: numOrNull(raw.regularMarketVolume),
    averageVolume: numOrNull(raw.averageDailyVolume3Month),
    marketCap: numOrNull(raw.marketCap),
    trailingPE: numOrNull(raw.trailingPE),
    forwardPE: numOrNull(raw.forwardPE),
    dividendYield: numOrNull(raw.dividendYield),
    fiftyTwoWeekHigh: numOrNull(raw.fiftyTwoWeekHigh),
    fiftyTwoWeekLow: numOrNull(raw.fiftyTwoWeekLow),
    shortName: (raw.shortName as string) ?? null,
    longName: (raw.longName as string) ?? null,
    exchange: (raw.fullExchangeName as string) ?? (raw.exchange as string) ?? null,
  };
}

/** Quote in blocchi da 50 simboli. Restituisce solo quelle ottenute. */
export async function fetchQuotes(symbols: string[]): Promise<QuoteData[]> {
  if (symbols.length === 0) return [];
  const yahoo = await getYahoo();
  const out: QuoteData[] = [];

  for (let i = 0; i < symbols.length; i += 50) {
    const batch = symbols.slice(i, i + 50);
    try {
      const raw = await limit(() => yahoo.quote(batch));
      const list = Array.isArray(raw) ? raw : [raw];
      out.push(...list.filter(Boolean).map(mapQuote));
    } catch (error) {
      console.warn(`quote fallita per ${batch.length} simboli:`, (error as Error).message);
    }
  }
  return out;
}

export async function fetchQuote(symbol: string): Promise<QuoteData | null> {
  const [quote] = await fetchQuotes([symbol]);
  return quote ?? null;
}
