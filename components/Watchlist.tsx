"use client";

import { useCallback, useEffect, useState } from "react";

import type { RankedStock, StockAnalysis } from "@/lib/analysis";
import type { PeriodId } from "@/lib/analytics/periods";
import { getWatchlist, removeWatch, subscribe, type WatchItem } from "@/lib/storage";
import { EmptyState, RowSkeleton, SectionCard, StockRow } from "./StockCard";

function toRanked(analysis: StockAnalysis): RankedStock {
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
    sparkline: analysis.sparkline,
    computedAt: analysis.computedAt,
  };
}

/**
 * Titoli seguiti già scaricati, per simbolo+periodo. Sopravvive al cambio pagina
 * (finché la scheda resta aperta) così tornare in dashboard non rianalizza tutto.
 */
const cache = new Map<string, { at: number; stock: RankedStock }>();
const CACHE_TTL = 5 * 60 * 1000;

export function Watchlist({
  period,
  known,
}: {
  period: PeriodId;
  /** Titoli già analizzati dalla dashboard: evita richieste inutili. */
  known: Map<string, RankedStock>;
}) {
  const [items, setItems] = useState<WatchItem[]>([]);
  const [data, setData] = useState<Record<string, RankedStock>>(() => {
    const now = Date.now();
    const seed: Record<string, RankedStock> = {};
    for (const [key, hit] of cache) {
      if (key.endsWith(`::${period}`) && now - hit.at < CACHE_TTL) seed[hit.stock.symbol] = hit.stock;
    }
    return seed;
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const sync = () => setItems(getWatchlist());
    sync();
    return subscribe(sync);
  }, []);

  const load = useCallback(async () => {
    const now = Date.now();
    const missing = items
      .filter((w) => {
        if (known.has(w.symbol)) return false;
        const hit = cache.get(`${w.symbol}::${period}`);
        return !hit || now - hit.at > CACHE_TTL;
      })
      .map((w) => w.symbol);
    if (missing.length === 0) return;
    setLoading(true);
    const results = await Promise.all(
      missing.map(async (symbol) => {
        try {
          const res = await fetch(`/api/analisi/${encodeURIComponent(symbol)}?period=${period}`);
          if (!res.ok) return null;
          const json = (await res.json()) as { analysis: StockAnalysis };
          return toRanked(json.analysis);
        } catch {
          return null;
        }
      }),
    );
    setData((prev) => {
      const next = { ...prev };
      for (const r of results) {
        if (!r) continue;
        next[r.symbol] = r;
        cache.set(`${r.symbol}::${period}`, { at: Date.now(), stock: r });
      }
      return next;
    });
    setLoading(false);
  }, [items, known, period]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = items
    .map((w) => known.get(w.symbol) ?? data[w.symbol])
    .filter((s): s is RankedStock => Boolean(s));

  return (
    <SectionCard
      title="Mercati seguiti"
      subtitle="Salvati nel browser, nessun account. Aggiungi titoli dalla loro scheda."
      action={
        loading ? <span className="text-xs text-base-400">aggiornamento…</span> : undefined
      }
    >
      {items.length === 0 ? (
        <EmptyState message="Nessun titolo seguito. Cerca un'azione e premi “Segui” nella sua scheda." />
      ) : rows.length === 0 ? (
        <RowSkeleton count={Math.min(items.length, 4)} />
      ) : (
        <div className="grid gap-2 lg:grid-cols-2">
          {rows.map((stock) => (
            <StockRow
              key={stock.symbol}
              stock={stock}
              showVerdict
              action={
                <button
                  type="button"
                  onClick={() => removeWatch(stock.symbol)}
                  title="Smetti di seguire"
                  className="rounded-md p-1 text-base-400 transition-colors hover:bg-base-800 hover:text-fall-500"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                  </svg>
                </button>
              }
            />
          ))}
        </div>
      )}
    </SectionCard>
  );
}
