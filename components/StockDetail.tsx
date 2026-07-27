"use client";

import { useCallback, useEffect, useState } from "react";

import type { StockAnalysis } from "@/lib/analysis";
import { PERIODS, parsePeriod, type PeriodId } from "@/lib/analytics/periods";
import type { OrderBook } from "@/lib/data/orderbook";
import type { QuoteData } from "@/lib/data/yahoo";
import {
  MONTH_NAMES,
  formatCompact,
  formatNumber,
  formatPercent,
  formatPrice,
  relativeTime,
  signClass,
} from "@/lib/format";
import { isWatched, subscribe, toggleWatch } from "@/lib/storage";
import { ConfidenceDots, ProbabilityBar, SignalBars, StatTile, VerdictBadge } from "./Indicators";
import { PriceChart } from "./PriceChart";
import { PeriodSelector } from "./Selectors";

interface DetailResponse {
  analysis: StockAnalysis;
  quote: QuoteData | null;
  isin: string | null;
  orderBook: OrderBook;
  benchmarkSymbol: string;
  priceSource: string;
  delayed: boolean;
  error?: string;
}

export function StockDetail({ symbol }: { symbol: string }) {
  const [period, setPeriod] = useState<PeriodId>(() =>
    parsePeriod(typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("period") : null),
  );
  const [data, setData] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [watched, setWatched] = useState(false);

  useEffect(() => {
    const sync = () => setWatched(isWatched(symbol));
    sync();
    return subscribe(sync);
  }, [symbol]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/analisi/${encodeURIComponent(symbol)}?period=${period}`);
      const json = (await res.json()) as DetailResponse;
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setData(json);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [symbol, period]);

  useEffect(() => {
    void load();
  }, [load]);

  const analysis = data?.analysis;
  const quote = data?.quote;
  const currency = analysis?.currency ?? quote?.currency ?? "";

  return (
    <div className="space-y-4">
      {/* Intestazione */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{symbol}</h1>
            {analysis?.signal && <VerdictBadge verdict={analysis.signal.verdict} size="lg" />}
          </div>
          <p className="mt-0.5 truncate text-sm text-base-400">
            {analysis?.name ?? quote?.longName ?? "—"}
            {analysis?.exchange ? ` · ${analysis.exchange}` : ""}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setWatched(toggleWatch(symbol, analysis?.name ?? symbol))}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              watched
                ? "border-accent-500/40 bg-accent-500/15 text-accent-400"
                : "border-base-700 text-base-300 hover:border-base-600 hover:text-base-100"
            }`}
          >
            {watched ? "✓ Seguito" : "+ Segui"}
          </button>
          <PeriodSelector value={period} onChange={setPeriod} compact />
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-fall-500/40 bg-fall-500/10 px-4 py-3 text-sm text-fall-500">
          {error}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <PriceChart symbol={symbol} period={period} currency={currency} />

        {/* Probabilità */}
        <div className="card space-y-4 p-4">
          <div>
            <h2 className="text-sm font-semibold">Probabilità sull'orizzonte</h2>
            <p className="mt-0.5 text-xs text-base-400">
              Prossimi {analysis?.horizonDays ?? PERIODS[period].horizonDays ?? "—"} giorni di borsa
              ({PERIODS[period].label.toLowerCase()})
            </p>
          </div>

          {loading && !analysis ? (
            <div className="skeleton h-40 w-full" />
          ) : analysis ? (
            <>
              <div className="flex items-end gap-4">
                <div>
                  <div className="text-3xl font-semibold text-rise-500">
                    {formatPercent(analysis.probability.pUp * 100, 1)}
                  </div>
                  <div className="text-xs text-base-400">probabilità di salita</div>
                </div>
                <div className="ml-auto text-right">
                  <div className="text-3xl font-semibold text-fall-500">
                    {formatPercent(analysis.probability.pDown * 100, 1)}
                  </div>
                  <div className="text-xs text-base-400">probabilità di discesa</div>
                </div>
              </div>

              <ProbabilityBar
                pUp={analysis.probability.pUp}
                ci95={analysis.probability.ci95}
                height="h-3"
                showLabels={false}
              />

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-base-400">
                <span>
                  Intervallo 95%: {formatPercent(analysis.probability.ci95[0] * 100, 1)} –{" "}
                  {formatPercent(analysis.probability.ci95[1] * 100, 1)}
                </span>
                <span className="flex items-center gap-1.5">
                  Affidabilità <ConfidenceDots confidence={analysis.probability.confidence} />
                </span>
                <span>{analysis.probability.effectiveSamples} campioni indipendenti</span>
              </div>

              {analysis.probability.degraded && (
                <p className="rounded-lg border border-hold-500/30 bg-hold-500/10 px-3 py-2 text-xs text-hold-500">
                  Storico limitato: la stima è poco affidabile e va letta come indicativa.
                </p>
              )}

              {/* Come è composta la stima */}
              <div>
                <div className="mb-1.5 text-xs font-medium text-base-300">Modelli combinati</div>
                <table className="w-full text-xs">
                  <thead className="text-base-400">
                    <tr>
                      <th className="pb-1 text-left font-normal">Modello</th>
                      <th className="pb-1 text-right font-normal">Sale</th>
                      <th className="pb-1 text-right font-normal">Peso</th>
                      <th className="pb-1 text-right font-normal" title="Errore quadratico medio fuori campione: più basso è meglio">
                        Brier
                      </th>
                    </tr>
                  </thead>
                  <tbody className="tabular">
                    {analysis.probability.components.map((c) => (
                      <tr key={c.name} className="border-t border-base-800">
                        <td className="py-1 text-left font-sans text-base-300">{c.label}</td>
                        <td className="py-1 text-right">{formatPercent(c.pUp * 100, 1)}</td>
                        <td className="py-1 text-right text-base-400">
                          {formatPercent(c.weight * 100, 0)}
                        </td>
                        <td className="py-1 text-right text-base-400">
                          {c.brier === null ? "n/d" : formatNumber(c.brier, 3)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-1.5 text-[11px] leading-relaxed text-base-400">
                  I pesi sono proporzionali a 1/Brier misurato con validazione walk-forward su questo
                  titolo: chi ha sbagliato meno in passato conta di più.
                </p>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-base-300">Compra / Vendi / Mantieni</span>
                  <VerdictBadge verdict={analysis.signal.verdict} />
                </div>
                <SignalBars
                  buy={analysis.signal.buy}
                  sell={analysis.signal.sell}
                  keep={analysis.signal.keep}
                />
              </div>
            </>
          ) : null}
        </div>
      </div>

      {/* Dati sui prezzi + book */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="card p-4">
          <h2 className="mb-3 text-sm font-semibold">Dati sui prezzi</h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            <Field label="Simbolo" value={symbol} mono />
            <Field label="ISIN" value={data?.isin ?? "n/d"} mono />
            <Field label="Valuta" value={currency || "n/d"} />
            <Field label="Ultimo prezzo" value={formatPrice(analysis?.price, currency)} />
            <Field
              label="Variazione"
              value={formatPercent(analysis?.changePercent, 2, true)}
              className={signClass(analysis?.changePercent)}
            />
            <Field label="Chiusura prec." value={formatPrice(analysis?.previousClose, currency)} />
            <Field label="Apertura" value={formatPrice(quote?.open ?? null, currency)} />
            <Field label="Massimo giorno" value={formatPrice(quote?.dayHigh ?? null, currency)} />
            <Field label="Minimo giorno" value={formatPrice(quote?.dayLow ?? null, currency)} />
            <Field label="Volume" value={formatCompact(quote?.volume ?? null)} />
            <Field label="Volume medio 3m" value={formatCompact(quote?.averageVolume ?? null)} />
            <Field label="Capitalizzazione" value={formatCompact(quote?.marketCap ?? null)} />
            <Field label="P/E storico" value={formatNumber(quote?.trailingPE ?? null, 2)} />
            <Field label="P/E atteso" value={formatNumber(quote?.forwardPE ?? null, 2)} />
            <Field
              label="Dividend yield"
              value={
                quote?.dividendYield === null || quote?.dividendYield === undefined
                  ? "n/d"
                  : formatPercent(quote.dividendYield, 2)
              }
            />
            <Field
              label="Massimo 52 sett."
              value={formatPrice(analysis?.stats.fiftyTwoWeekHigh ?? null, currency)}
            />
            <Field
              label="Minimo 52 sett."
              value={formatPrice(analysis?.stats.fiftyTwoWeekLow ?? null, currency)}
            />
            <Field
              label="Posizione nel range"
              value={formatPercent(analysis?.stats.positionIn52w ?? null, 1)}
            />
            <Field label="Fonte prezzo" value={data?.priceSource ?? "—"} />
            <Field
              label="Variazione periodo"
              value={formatPercent(analysis?.periodChangePercent, 2, true)}
              className={signClass(analysis?.periodChangePercent)}
            />
            <Field label="Calcolato" value={relativeTime(analysis?.computedAt ?? null)} />
          </dl>
        </div>

        <OrderBookPanel book={data?.orderBook} currency={currency} />
      </div>

      {/* Statistiche */}
      {analysis && (
        <div className="card p-4">
          <h2 className="mb-3 text-sm font-semibold">Statistiche e rischio</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <StatTile
              label="Volatilità annua"
              value={formatPercent(analysis.stats.volatilityAnnual, 1)}
              hint="Deviazione standard dei rendimenti, annualizzata (stima EWMA)"
            />
            <StatTile
              label="Movimento atteso"
              value={`± ${formatPercent(analysis.stats.expectedMovePercent, 1)}`}
              hint="Ampiezza a 1 sigma del movimento sull'orizzonte scelto"
            />
            <StatTile
              label="Rendimento atteso"
              value={formatPercent(analysis.stats.expectedReturnPercent, 2, true)}
              valueClassName={signClass(analysis.stats.expectedReturnPercent)}
              hint="Drift stimato (con shrinkage) proiettato sull'orizzonte"
            />
            <StatTile
              label="Sharpe"
              value={formatNumber(analysis.stats.sharpe, 2)}
              valueClassName={signClass(analysis.stats.sharpe)}
              hint="Rendimento per unità di rischio, annualizzato"
            />
            <StatTile
              label="Sortino"
              value={formatNumber(analysis.stats.sortino, 2)}
              valueClassName={signClass(analysis.stats.sortino)}
              hint="Come lo Sharpe, ma penalizza solo la volatilità al ribasso"
            />
            <StatTile
              label="Max drawdown"
              value={formatPercent(analysis.stats.maxDrawdown, 1)}
              valueClassName="text-fall-500"
              hint="Peggiore perdita da massimo a minimo nello storico analizzato"
            />
            <StatTile
              label="VaR 95% (1g)"
              value={formatPercent(analysis.stats.var95, 2)}
              valueClassName="text-fall-500"
              hint="Perdita giornaliera superata solo nel 5% dei casi storici"
            />
            <StatTile
              label="CVaR 95% (1g)"
              value={formatPercent(analysis.stats.cvar95, 2)}
              valueClassName="text-fall-500"
              hint="Perdita media nei giorni peggiori oltre il VaR"
            />
            <StatTile
              label={`Beta vs ${data?.benchmarkSymbol ?? "indice"}`}
              value={formatNumber(analysis.stats.beta, 2)}
              hint="Sensibilità del titolo ai movimenti del suo indice"
            />
            <StatTile
              label="Asimmetria"
              value={formatNumber(analysis.stats.skewness, 2)}
              hint="Negativa = code di perdita più lunghe delle code di guadagno"
            />
            <StatTile
              label="Curtosi in eccesso"
              value={formatNumber(analysis.stats.excessKurtosis, 2)}
              hint="Oltre 0 = movimenti estremi più frequenti di una normale"
            />
            <StatTile
              label="RSI 14"
              value={formatNumber(analysis.stats.rsi, 1)}
              valueClassName={
                (analysis.stats.rsi ?? 50) > 70
                  ? "text-fall-500"
                  : (analysis.stats.rsi ?? 50) < 30
                    ? "text-rise-500"
                    : ""
              }
              hint="Sopra 70 ipercomprato, sotto 30 ipervenduto"
            />
            <StatTile
              label="MACD istogramma"
              value={formatNumber(analysis.stats.macdHistogram, 3)}
              valueClassName={signClass(analysis.stats.macdHistogram)}
              hint="Positivo = momentum in accelerazione"
            />
            <StatTile
              label="%B Bollinger"
              value={formatNumber(analysis.stats.percentB, 2)}
              hint="0 = banda inferiore, 1 = banda superiore"
            />
            <StatTile
              label="Distanza da SMA200"
              value={formatPercent(analysis.stats.distanceFromSma200, 1, true)}
              valueClassName={signClass(analysis.stats.distanceFromSma200)}
              hint="Sopra la media a 200 giorni = trend di lungo periodo rialzista"
            />
            <StatTile
              label="ATR 14"
              value={formatPercent(analysis.stats.atrPercent, 2)}
              hint="Escursione media giornaliera in percentuale sul prezzo"
            />
            <StatTile
              label="Volume relativo"
              value={
                analysis.stats.relativeVolume === null
                  ? "n/d"
                  : `${formatNumber(analysis.stats.relativeVolume, 2)}×`
              }
              hint="Volume di oggi rispetto alla media delle ultime 20 sedute"
            />
            <StatTile
              label="Punteggio trend"
              value={formatNumber(analysis.stats.trend, 2)}
              valueClassName={signClass(analysis.stats.trend)}
              hint="Da -1 a +1: sintesi di medie mobili e bande di Bollinger"
            />
            <StatTile
              label="Sedute analizzate"
              value={formatNumber(analysis.dataPoints, 0)}
              hint="Numero di chiusure giornaliere usate nei calcoli"
            />
            <StatTile
              label="Indice di riferimento"
              value={data?.benchmarkSymbol ?? "n/d"}
              hint="Usato per il calcolo del beta"
            />
          </div>
        </div>
      )}

      {/* Stagionalità */}
      {analysis && (
        <div className="card p-4">
          <h2 className="text-sm font-semibold">Stagionalità</h2>
          <p className="mb-3 mt-0.5 text-xs text-base-400">
            Rendimento medio storico per mese solare, riportato su un mese di 21 sedute. È una
            regolarità del passato, non una previsione.
          </p>
          <div className="flex items-end gap-1.5">
            {analysis.seasonality.map((month) => {
              const max = Math.max(
                ...analysis.seasonality.map((m) => Math.abs(m.averageReturn)),
                0.01,
              );
              const heightPercent = (Math.abs(month.averageReturn) / max) * 100;
              const positive = month.averageReturn >= 0;
              return (
                <div key={month.month} className="flex flex-1 flex-col items-center gap-1">
                  <div className="flex h-24 w-full flex-col justify-end">
                    <div
                      className={`w-full rounded-t ${positive ? "bg-rise-500/70" : "bg-fall-500/70"}`}
                      style={{ height: `${heightPercent}%` }}
                      title={`${MONTH_NAMES[month.month]}: ${formatPercent(month.averageReturn, 2, true)} su ${month.samples} osservazioni`}
                    />
                  </div>
                  <span className="text-[10px] text-base-400">{MONTH_NAMES[month.month]}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  className = "",
  mono = false,
}: {
  label: string;
  value: string;
  className?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-base-400">{label}</dt>
      <dd className={`${mono ? "tabular" : "tabular"} mt-0.5 font-medium ${className}`}>{value}</dd>
    </div>
  );
}

function OrderBookPanel({ book, currency }: { book: OrderBook | undefined; currency: string }) {
  return (
    <div className="card p-4">
      <h2 className="text-sm font-semibold">Portafoglio ordini</h2>
      <p className="mb-3 mt-0.5 text-xs text-base-400">{book?.source ?? "—"}</p>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-base-400">
            <th className="pb-2 text-left font-normal">Vol. denaro</th>
            <th className="pb-2 text-right font-normal">Denaro</th>
            <th className="pb-2 text-right font-normal">Lettera</th>
            <th className="pb-2 text-right font-normal">Vol. lettera</th>
          </tr>
        </thead>
        <tbody className="tabular">
          {book && book.levels.length > 0 ? (
            book.levels.map((level, i) => (
              <tr key={i} className="border-t border-base-800">
                <td className="py-1.5 text-left text-base-300">
                  {level.bidVolume === null ? "n/d" : formatCompact(level.bidVolume)}
                </td>
                <td className="py-1.5 text-right font-semibold text-rise-500">
                  {formatPrice(level.bidPrice, currency)}
                </td>
                <td className="py-1.5 text-right font-semibold text-fall-500">
                  {formatPrice(level.askPrice, currency)}
                </td>
                <td className="py-1.5 text-right text-base-300">
                  {level.askVolume === null ? "n/d" : formatCompact(level.askVolume)}
                </td>
              </tr>
            ))
          ) : (
            <tr className="border-t border-base-800">
              <td colSpan={4} className="py-4 text-center text-sm text-base-400">
                n/d
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {book && book.spread !== null && (
        <div className="mt-3 flex items-center justify-between rounded-lg bg-base-900/60 px-3 py-2 text-xs">
          <span className="text-base-400">Spread</span>
          <span className="tabular font-medium">
            {formatPrice(book.spread, currency, 4)} ({formatPercent(book.spreadPercent, 3)})
          </span>
        </div>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-base-400">{book?.note}</p>
    </div>
  );
}
