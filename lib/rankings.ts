/**
 * Classifiche: Top/Sub 10 e colonne Compra / Vendi / Mantieni.
 *
 * Analizzare 750 titoli richiede minuti, non i secondi di una richiesta HTTP.
 * Quindi i risultati vivono in `analysis_snapshot` (Neon) e vengono aggiornati
 * dal cron. Quando uno snapshot è scaduto la richiesta ne ricalcola comunque un
 * piccolo lotto ("stale-while-revalidate" fatto a mano): l'utente vede subito i
 * dati vecchi e le prossime visite trovano quelli nuovi.
 *
 * Il lotto NON viene atteso: la risposta parte con i dati in cache e il ricalcolo
 * gira dopo, passato a `after()` dalla route. Solo a freddo (nessuno snapshot)
 * si aspetta, altrimenti non ci sarebbe niente da mostrare.
 */

import { analyzeMany, type RankedStock } from "./analysis";
import type { PeriodId } from "./analytics/periods";
import { constituentsOf, type IndexId } from "./data/universe";
import { loadSnapshots, type StoredSnapshot } from "./db";

/** Uno snapshot più vecchio di così viene considerato da rinfrescare. */
export const SNAPSHOT_TTL_MS = 30 * 60 * 1000;

export interface RankingsResult {
  items: RankedStock[];
  total: number;
  fresh: number;
  /** Titoli mai analizzati o con snapshot scaduto. */
  pending: number;
  oldestComputedAt: number | null;
  refreshedNow: number;
  /**
   * Lotto di ricalcolo avviato in background. La route lo passa a `after()` per
   * tenerlo vivo oltre la risposta; non va serializzato nel JSON.
   */
  pendingRefresh?: Promise<unknown>;
}

/**
 * Cache di processo su snapshot e lotti in corso.
 *
 * ponytail: stato per istanza, non condiviso tra le lambda di Vercel. Nel caso
 * peggiore due istanze ricalcolano lo stesso lotto: spreco accettabile. Se
 * diventa un problema, spostare il lock su Neon (`SELECT ... FOR UPDATE`).
 */
const SNAPSHOT_CACHE_TTL = 10_000;
const snapshotCache = new Map<string, { at: number; rows: StoredSnapshot[] }>();
const inFlight = new Map<string, Promise<StoredSnapshot[]>>();

async function refreshBatch(symbols: string[], period: PeriodId): Promise<StoredSnapshot[]> {
  // Il salvataggio lo fa `analyzeMany`, titolo per titolo appena è pronto.
  const { snapshots } = await analyzeMany(symbols, period);
  return snapshots;
}

function isRanked(value: unknown): value is RankedStock {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as RankedStock).symbol === "string" &&
    typeof (value as RankedStock).pUp === "number"
  );
}

export async function getRankings(
  indexId: IndexId | null,
  period: PeriodId,
  { maxLazyRefresh = 12 }: { maxLazyRefresh?: number } = {},
): Promise<RankingsResult> {
  const symbols = constituentsOf(indexId).map((c) => c.symbol);
  const cacheKey = `${indexId ?? "all"}::${period}`;

  // Il polling della dashboard arriva ogni pochi secondi: rileggere 750 righe da
  // Neon ogni volta è inutile, gli snapshot cambiano solo quando gira un lotto.
  const cached = snapshotCache.get(cacheKey);
  let stored: StoredSnapshot[];
  if (cached && Date.now() - cached.at < SNAPSHOT_CACHE_TTL) {
    stored = cached.rows;
  } else {
    stored = await loadSnapshots(period, symbols);
    snapshotCache.set(cacheKey, { at: Date.now(), rows: stored });
  }

  const now = Date.now();
  const bySymbol = new Map<string, StoredSnapshot>();
  for (const s of stored) bySymbol.set(s.symbol, s);

  const staleOrMissing = symbols.filter((symbol) => {
    const snap = bySymbol.get(symbol);
    return !snap || now - snap.computedAt > SNAPSHOT_TTL_MS;
  });

  // Si ricalcolano prima i titoli mai visti, poi i più vecchi.
  const toRefresh = staleOrMissing
    .sort((a, b) => (bySymbol.get(a)?.computedAt ?? 0) - (bySymbol.get(b)?.computedAt ?? 0))
    .slice(0, maxLazyRefresh);

  let refreshedNow = 0;
  let pendingRefresh: Promise<StoredSnapshot[]> | undefined;

  if (toRefresh.length > 0) {
    // Un solo lotto per volta su indice+periodo: il polling della dashboard non
    // deve far partire richieste sovrapposte sugli stessi titoli.
    pendingRefresh = inFlight.get(cacheKey);
    if (!pendingRefresh) {
      pendingRefresh = refreshBatch(toRefresh, period).finally(() => {
        inFlight.delete(cacheKey);
        snapshotCache.delete(cacheKey);
      });
      inFlight.set(cacheKey, pendingRefresh);
    }

    // A freddo non c'è niente da mostrare: qui vale la pena aspettare.
    if (bySymbol.size === 0) {
      const fresh = await pendingRefresh.catch(() => [] as StoredSnapshot[]);
      refreshedNow = fresh.length;
      for (const s of fresh) bySymbol.set(s.symbol, s);
      pendingRefresh = undefined;
    }
  }

  const items: RankedStock[] = [];
  let oldest: number | null = null;
  for (const snap of bySymbol.values()) {
    if (!isRanked(snap.metrics)) continue;
    items.push(snap.metrics);
    oldest = oldest === null ? snap.computedAt : Math.min(oldest, snap.computedAt);
  }

  const fresh = items.filter((i) => now - i.computedAt <= SNAPSHOT_TTL_MS).length;

  return {
    items,
    total: symbols.length,
    fresh,
    pending: Math.max(0, staleOrMissing.length - refreshedNow),
    oldestComputedAt: oldest,
    refreshedNow,
    pendingRefresh,
  };
}

export interface DashboardData extends RankingsResult {
  top: RankedStock[];
  bottom: RankedStock[];
  buy: RankedStock[];
  sell: RankedStock[];
  keep: RankedStock[];
}

/** Ordina i risultati nelle sezioni della dashboard. */
export function toDashboard(result: RankingsResult, size = 10): DashboardData {
  const byProbability = [...result.items].sort((a, b) => b.pUp - a.pUp);

  // Nelle colonne di consiglio ordiniamo per convinzione: prima la percentuale
  // della colonna, a parità di percentuale la probabilità di salita.
  const column = (verdict: RankedStock["verdict"], score: (s: RankedStock) => number) =>
    result.items
      .filter((s) => s.verdict === verdict)
      .sort((a, b) => score(b) - score(a) || b.confidence - a.confidence)
      .slice(0, size);

  return {
    ...result,
    top: byProbability.slice(0, size),
    bottom: byProbability.slice(-size).reverse(),
    buy: column("buy", (s) => s.buy),
    sell: column("sell", (s) => s.sell),
    keep: column("keep", (s) => s.keep),
  };
}
