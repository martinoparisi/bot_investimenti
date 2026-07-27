"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import type { RankedStock } from "@/lib/analysis";
import { PERIODS, parsePeriod, type PeriodId } from "@/lib/analytics/periods";
import { INDEXES, parseIndexId, type IndexId } from "@/lib/data/universe";
import { relativeTime } from "@/lib/format";
import { getWatchlist } from "@/lib/storage";
import { IndexSelector, PeriodSelector } from "./Selectors";
import { EmptyState, RowSkeleton, SectionCard, StockRow } from "./StockCard";
import { Watchlist } from "./Watchlist";

interface DashboardResponse {
  top: RankedStock[];
  bottom: RankedStock[];
  buy: RankedStock[];
  sell: RankedStock[];
  keep: RankedStock[];
  items: RankedStock[];
  total: number;
  fresh: number;
  pending: number;
  oldestComputedAt: number | null;
  refreshedNow: number;
  error?: string;
}

/** Ogni quanto la pagina richiede l'avanzamento dei calcoli. */
const AUTO_REFRESH_MS = 3000;

/**
 * Ultima risposta per indice+periodo, viva finché la scheda resta aperta.
 * Tornare alla dashboard da una scheda titolo mostra subito i dati di prima,
 * poi l'aggiornamento arriva in sottofondo: niente più scheletro a ogni giro.
 */
const cache = new Map<string, DashboardResponse>();

export function Dashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const period = parsePeriod(searchParams.get("period"));
  const indexId = parseIndexId(searchParams.get("index"));
  const cacheKey = `${indexId ?? "all"}:${period}`;

  const [data, setData] = useState<DashboardResponse | null>(() => cache.get(cacheKey) ?? null);
  const [loading, setLoading] = useState(() => !cache.has(cacheKey));
  const [error, setError] = useState<string | null>(null);
  // Cresce a ogni chiamata conclusa, anche fallita: è il battito che tiene vivo
  // il polling quando la risposta non cambia i dati (errore di rete, lotto ancora
  // in corso). Senza, l'effetto non si riattiverebbe e servirebbe ricaricare.
  const [tick, setTick] = useState(0);

  const setQuery = useCallback(
    (next: { period?: PeriodId; index?: IndexId | null }) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next.period) params.set("period", next.period);
      if (next.index !== undefined) {
        if (next.index === null) params.delete("index");
        else params.set("index", next.index);
      }
      router.replace(`/?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const load = useCallback(async () => {
    const params = new URLSearchParams({ period });
    if (indexId) params.set("index", indexId);
    // I titoli seguiti sono gli unici per cui serve il dato completo.
    const watch = getWatchlist().map((w) => w.symbol);
    if (watch.length > 0) params.set("watch", watch.join(","));
    try {
      const res = await fetch(`/api/classifiche?${params.toString()}`);
      const json = (await res.json()) as DashboardResponse;
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      cache.set(cacheKey, json);
      setData(json);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setTick((t) => t + 1);
    }
  }, [period, indexId, cacheKey]);

  // Cambio di indice o periodo: si mostra la copia in cache, se c'è, mentre
  // l'aggiornamento viaggia.
  useEffect(() => {
    const cached = cache.get(cacheKey);
    setData(cached ?? null);
    setLoading(!cached);
    void load();
  }, [cacheKey, load]);

  // I titoli non ancora calcolati vengono completati poco per volta: ogni
  // chiamata ne analizza un lotto e la pagina si riempie progressivamente.
  // Va avanti da sola fino alla fine: anche i titoli che non si scaricano
  // lasciano una riga a database, quindi `pending` arriva sempre a zero.
  useEffect(() => {
    if (!data || data.pending === 0) return;
    const timer = setTimeout(() => void load(), AUTO_REFRESH_MS);
    return () => clearTimeout(timer);
  }, [data, tick, load]);

  const known = useMemo(() => {
    const map = new Map<string, RankedStock>();
    for (const item of data?.items ?? []) map.set(item.symbol, item);
    return map;
  }, [data]);

  const indexLabel = indexId ? INDEXES[indexId].label : "tutti gli indici";
  const progress = data ? Math.round(((data.total - data.pending) / data.total) * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Dashboard</h1>
          <p className="text-xs text-base-400">
            {indexLabel} · analisi sugli ultimi {PERIODS[period].label.toLowerCase()}, probabilità
            riferita ai prossimi {PERIODS[period].label.toLowerCase()}
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <IndexSelector value={indexId} onChange={(v) => setQuery({ index: v })} />
          <PeriodSelector value={period} onChange={(v) => setQuery({ period: v })} compact />
        </div>
      </div>

      {data && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-base-800 bg-base-900/40 px-3 py-2 text-xs text-base-400">
          <span>
            <span className="tabular font-semibold text-base-100">
              {data.total - data.pending}/{data.total}
            </span>{" "}
            titoli analizzati
          </span>
          <div className="h-1 w-24 overflow-hidden rounded-full bg-base-800 sm:w-32">
            <div className="h-full bg-accent-500 transition-[width]" style={{ width: `${progress}%` }} />
          </div>
          {data.pending > 0 && (
            <span className="text-accent-400">calcolo in corso… {data.pending} mancanti</span>
          )}
          <span className="w-full sm:ml-auto sm:w-auto">
            aggiornamento più vecchio: {relativeTime(data.oldestComputedAt)}
          </span>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-fall-500/40 bg-fall-500/10 px-4 py-3 text-sm text-fall-500">
          Errore nel caricamento delle classifiche: {error}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard
          title="Top 10"
          subtitle="Probabilità di salita più alta sull'orizzonte scelto"
        >
          {loading && !data ? (
            <RowSkeleton />
          ) : data && data.top.length > 0 ? (
            <div className="space-y-2">
              {data.top.map((stock, i) => (
                <StockRow key={stock.symbol} stock={stock} rank={i + 1} showVerdict />
              ))}
            </div>
          ) : (
            <EmptyState message="Nessun dato disponibile." />
          )}
        </SectionCard>

        <SectionCard
          title="Sub 10"
          subtitle="Probabilità di salita più bassa: i titoli più a rischio"
        >
          {loading && !data ? (
            <RowSkeleton />
          ) : data && data.bottom.length > 0 ? (
            <div className="space-y-2">
              {data.bottom.map((stock, i) => (
                <StockRow key={stock.symbol} stock={stock} rank={i + 1} showVerdict />
              ))}
            </div>
          ) : (
            <EmptyState message="Nessun dato disponibile." />
          )}
        </SectionCard>
      </div>

      <Watchlist period={period} known={known} />

      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard title="Compra" subtitle="Segnale di acquisto più convinto">
          <SignalColumn
            stocks={data?.buy}
            loading={loading && !data}
            pick={(s) => s.buy}
            empty="Nessun titolo con segnale di acquisto prevalente."
          />
        </SectionCard>
        <SectionCard title="Vendi" subtitle="Segnale di vendita più convinto">
          <SignalColumn
            stocks={data?.sell}
            loading={loading && !data}
            pick={(s) => s.sell}
            empty="Nessun titolo con segnale di vendita prevalente."
          />
        </SectionCard>
        <SectionCard title="Mantieni" subtitle="Meglio non muoversi: stima poco netta">
          <SignalColumn
            stocks={data?.keep}
            loading={loading && !data}
            pick={(s) => s.keep}
            empty="Nessun titolo in attesa."
          />
        </SectionCard>
      </div>
    </div>
  );
}

function SignalColumn({
  stocks,
  loading,
  pick,
  empty,
}: {
  stocks: RankedStock[] | undefined;
  loading: boolean;
  pick: (s: RankedStock) => number;
  empty: string;
}) {
  if (loading) return <RowSkeleton count={4} />;
  if (!stocks || stocks.length === 0) return <EmptyState message={empty} />;
  return (
    <div className="space-y-2">
      {stocks.map((stock) => (
        <StockRow key={stock.symbol} stock={stock} signalValue={pick(stock)} />
      ))}
    </div>
  );
}
