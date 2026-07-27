"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import type { StockAnalysis } from "@/lib/analysis";
import { PERIODS, parsePeriod, type PeriodId } from "@/lib/analytics/periods";
import { aggregateSignals, type SignalResult } from "@/lib/analytics/signal";
import {
  formatDate,
  formatNumber,
  formatPercent,
  formatPrice,
  signClass,
} from "@/lib/format";
import {
  addPosition,
  exportData,
  getPositions,
  importData,
  removePosition,
  savePositions,
  subscribe,
  updatePosition,
  type Position,
} from "@/lib/storage";
import { ConfidenceDots, ProbabilityBar, SignalBars, VerdictBadge } from "./Indicators";
import { PeriodSelector } from "./Selectors";
import { SectionCard, EmptyState } from "./StockCard";

/** Aliquota italiana sulle plusvalenze finanziarie (redditi diversi). */
const CAPITAL_GAIN_TAX = 0.26;

interface SymbolData {
  analysis: StockAnalysis;
  /** Prima chiusura dell'anno solare in corso: base per la plusvalenza fiscale. */
  yearStartPrice: number | null;
}

interface Computed {
  position: Position;
  price: number | null;
  currency: string;
  costBasis: number;
  currentValue: number;
  plTotal: number;
  plTotalPercent: number;
  plFiscalYear: number;
  realized: number;
  closed: boolean;
  data: SymbolData | null;
}

const EMPTY_FORM = {
  symbol: "",
  name: "",
  quantity: "",
  buyPrice: "",
  buyDate: new Date().toISOString().slice(0, 10),
  fees: "",
  currency: "EUR",
  notes: "",
};

export function Portfolio() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [period, setPeriod] = useState<PeriodId>(() => parsePeriod("1m"));
  const [data, setData] = useState<Record<string, SymbolData>>({});
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const sync = () => setPositions(getPositions());
    sync();
    return subscribe(sync);
  }, []);

  const symbols = useMemo(
    () => Array.from(new Set(positions.map((p) => p.symbol.toUpperCase()))),
    [positions],
  );

  const load = useCallback(async () => {
    if (symbols.length === 0) return;
    setLoading(true);
    const results = await Promise.all(
      symbols.map(async (symbol) => {
        try {
          const [analysisRes, chartRes] = await Promise.all([
            fetch(`/api/analisi/${encodeURIComponent(symbol)}?period=${period}`),
            fetch(`/api/chart?symbol=${encodeURIComponent(symbol)}&period=ytd`),
          ]);
          if (!analysisRes.ok) return null;
          const analysisJson = (await analysisRes.json()) as { analysis: StockAnalysis };
          let yearStartPrice: number | null = null;
          if (chartRes.ok) {
            const chartJson = (await chartRes.json()) as { candles?: { close: number }[] };
            yearStartPrice = chartJson.candles?.[0]?.close ?? null;
          }
          return [symbol, { analysis: analysisJson.analysis, yearStartPrice }] as const;
        } catch {
          return null;
        }
      }),
    );
    setData(Object.fromEntries(results.filter(Boolean) as [string, SymbolData][]));
    setLoading(false);
  }, [symbols, period]);

  useEffect(() => {
    void load();
  }, [load]);

  const computed: Computed[] = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return positions.map((position) => {
      const symbolData = data[position.symbol.toUpperCase()] ?? null;
      const price = symbolData?.analysis.price ?? null;
      const currency = symbolData?.analysis.currency || position.currency || "EUR";
      const costBasis = position.quantity * position.buyPrice + (position.fees || 0);
      const closed = Boolean(position.soldPrice && position.soldDate);

      const soldQuantity = position.soldQuantity ?? position.quantity;
      const realized = closed
        ? (position.soldPrice as number) * soldQuantity -
          position.buyPrice * soldQuantity -
          (position.fees || 0)
        : 0;

      const currentValue = closed
        ? (position.soldPrice as number) * soldQuantity
        : price !== null
          ? price * position.quantity
          : 0;

      const plTotal = closed ? realized : price !== null ? currentValue - costBasis : 0;
      const plTotalPercent = costBasis > 0 ? (plTotal / costBasis) * 100 : 0;

      // Plusvalenza dell'anno fiscale in corso (anno solare italiano).
      let plFiscalYear = 0;
      if (closed) {
        const soldYear = new Date(position.soldDate as string).getFullYear();
        plFiscalYear = soldYear === currentYear ? realized : 0;
      } else if (price !== null) {
        const boughtThisYear = new Date(position.buyDate).getFullYear() === currentYear;
        const base = boughtThisYear
          ? costBasis
          : (symbolData?.yearStartPrice ?? position.buyPrice) * position.quantity;
        plFiscalYear = currentValue - base;
      }

      return {
        position,
        price,
        currency,
        costBasis,
        currentValue,
        plTotal,
        plTotalPercent,
        plFiscalYear,
        realized: closed && new Date(position.soldDate as string).getFullYear() === currentYear ? realized : 0,
        closed,
        data: symbolData,
      };
    });
  }, [positions, data]);

  /** Totali separati per valuta: sommare euro e dollari darebbe un numero falso. */
  const totalsByCurrency = useMemo(() => {
    const map = new Map<
      string,
      { invested: number; value: number; plTotal: number; plFiscal: number; realized: number }
    >();
    for (const row of computed) {
      const current = map.get(row.currency) ?? {
        invested: 0,
        value: 0,
        plTotal: 0,
        plFiscal: 0,
        realized: 0,
      };
      if (!row.closed) {
        current.invested += row.costBasis;
        current.value += row.currentValue;
      }
      current.plTotal += row.plTotal;
      current.plFiscal += row.plFiscalYear;
      current.realized += row.realized;
      map.set(row.currency, current);
    }
    return map;
  }, [computed]);

  const openRows = computed.filter((r) => !r.closed && r.data);
  const aggregated: SignalResult = useMemo(
    () =>
      aggregateSignals(
        openRows.map((r) => ({
          signal: r.data!.analysis.signal,
          weight: Math.max(r.currentValue, 0),
        })),
      ),
    [openRows],
  );

  const weightedPUp = useMemo(() => {
    const totalWeight = openRows.reduce((a, r) => a + Math.max(r.currentValue, 0), 0);
    if (totalWeight <= 0) return null;
    return openRows.reduce(
      (a, r) => a + r.data!.analysis.probability.pUp * (Math.max(r.currentValue, 0) / totalWeight),
      0,
    );
  }, [openRows]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const quantity = Number(form.quantity.replace(",", "."));
    const buyPrice = Number(form.buyPrice.replace(",", "."));
    const symbol = form.symbol.trim().toUpperCase();
    if (!symbol || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(buyPrice) || buyPrice <= 0) {
      setMessage("Inserisci simbolo, quantità e prezzo di carico validi.");
      return;
    }
    addPosition({
      symbol,
      name: form.name.trim() || symbol,
      quantity,
      buyPrice,
      buyDate: form.buyDate,
      fees: Number(form.fees.replace(",", ".")) || 0,
      currency: form.currency.trim().toUpperCase() || "EUR",
      notes: form.notes.trim() || undefined,
    });
    setForm({ ...EMPTY_FORM });
    setMessage(`Aggiunto ${symbol}.`);
  };

  const registerSale = (position: Position) => {
    const priceRaw = window.prompt(`Prezzo di vendita per ${position.symbol}`, "");
    if (!priceRaw) return;
    const soldPrice = Number(priceRaw.replace(",", "."));
    if (!Number.isFinite(soldPrice) || soldPrice <= 0) {
      setMessage("Prezzo di vendita non valido.");
      return;
    }
    const dateRaw =
      window.prompt("Data di vendita (aaaa-mm-gg)", new Date().toISOString().slice(0, 10)) ?? "";
    updatePosition(position.id, {
      soldPrice,
      soldDate: dateRaw || new Date().toISOString().slice(0, 10),
      soldQuantity: position.quantity,
    });
    setMessage(`Vendita registrata per ${position.symbol}.`);
  };

  const onImport = async (file: File) => {
    const result = importData(await file.text());
    setMessage(result.message);
    if (result.ok) setPositions(getPositions());
  };

  const download = () => {
    const blob = new Blob([exportData()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `portafoglio-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Il mio conto</h1>
          <p className="text-xs text-base-400">
            Salvato solo in questo browser. Nessun account, nessun dato inviato a terzi.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PeriodSelector value={period} onChange={setPeriod} compact />
          <button
            type="button"
            onClick={download}
            className="rounded-lg border border-base-700 px-3 py-1.5 text-xs text-base-300 hover:border-base-600 hover:text-base-100"
          >
            Esporta JSON
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="rounded-lg border border-base-700 px-3 py-1.5 text-xs text-base-300 hover:border-base-600 hover:text-base-100"
          >
            Importa JSON
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onImport(file);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {message && (
        <div className="rounded-xl border border-accent-500/30 bg-accent-500/10 px-4 py-2 text-sm text-accent-400">
          {message}
        </div>
      )}

      {/* Riepilogo */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <SectionCard
          title="Riepilogo"
          subtitle={`Aliquota considerata sulle plusvalenze realizzate: ${CAPITAL_GAIN_TAX * 100}%`}
        >
          {totalsByCurrency.size === 0 ? (
            <EmptyState message="Nessun movimento inserito." />
          ) : (
            <div className="space-y-3">
              {Array.from(totalsByCurrency.entries()).map(([currency, totals]) => (
                <div key={currency} className="rounded-xl border border-base-800 bg-base-900/40 p-3">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-base-400">
                    {currency}
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                    <Metric label="Investito" value={formatPrice(totals.invested, currency)} />
                    <Metric label="Valore attuale" value={formatPrice(totals.value, currency)} />
                    <Metric
                      label="Plusvalenza totale"
                      value={formatPrice(totals.plTotal, currency)}
                      className={signClass(totals.plTotal)}
                      hint="Differenza fra valore attuale e prezzo di carico, comprese le commissioni"
                    />
                    <Metric
                      label={`Plusvalenza ${new Date().getFullYear()}`}
                      value={formatPrice(totals.plFiscal, currency)}
                      className={signClass(totals.plFiscal)}
                      hint="Anno fiscale in corso: realizzata + variazione da inizio anno sulle posizioni aperte"
                    />
                    <Metric
                      label="Imposta stimata"
                      value={formatPrice(Math.max(0, totals.realized) * CAPITAL_GAIN_TAX, currency)}
                      hint="26% sulle sole plusvalenze realizzate quest'anno. Stima indicativa: non tiene conto di minusvalenze pregresse né del regime fiscale scelto."
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Segnale di portafoglio" subtitle="Media pesata per controvalore">
          {openRows.length === 0 ? (
            <EmptyState message="Nessuna posizione aperta." />
          ) : (
            <div className="space-y-4">
              {weightedPUp !== null && (
                <div>
                  <div className="mb-1.5 flex items-baseline justify-between">
                    <span className="text-2xl font-semibold text-rise-500">
                      {formatPercent(weightedPUp * 100, 1)}
                    </span>
                    <span className="text-2xl font-semibold text-fall-500">
                      {formatPercent((1 - weightedPUp) * 100, 1)}
                    </span>
                  </div>
                  <ProbabilityBar pUp={weightedPUp} showLabels={false} height="h-2.5" />
                  <p className="mt-1 text-xs text-base-400">
                    Probabilità che il portafoglio salga nei prossimi{" "}
                    {PERIODS[period].label.toLowerCase()}
                  </p>
                </div>
              )}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-base-300">Consiglio complessivo</span>
                  <VerdictBadge verdict={aggregated.verdict} />
                </div>
                <SignalBars buy={aggregated.buy} sell={aggregated.sell} keep={aggregated.keep} />
              </div>
            </div>
          )}
        </SectionCard>
      </div>

      {/* Nuovo movimento */}
      <SectionCard
        title="Aggiungi un movimento"
        subtitle="Il simbolo è quello di Yahoo Finance: ISP.MI, AAPL, III.L. Cercalo dalla barra in alto se non lo conosci."
      >
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input label="Simbolo" value={form.symbol} onChange={(v) => setForm({ ...form, symbol: v })} placeholder="ISP.MI" required />
          <Input label="Nome (facoltativo)" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="Intesa Sanpaolo" />
          <Input label="Quantità" value={form.quantity} onChange={(v) => setForm({ ...form, quantity: v })} placeholder="100" required inputMode="decimal" />
          <Input label="Prezzo di carico" value={form.buyPrice} onChange={(v) => setForm({ ...form, buyPrice: v })} placeholder="3,45" required inputMode="decimal" />
          <Input label="Data acquisto" value={form.buyDate} onChange={(v) => setForm({ ...form, buyDate: v })} type="date" required />
          <Input label="Commissioni" value={form.fees} onChange={(v) => setForm({ ...form, fees: v })} placeholder="5" inputMode="decimal" />
          <Input label="Valuta" value={form.currency} onChange={(v) => setForm({ ...form, currency: v })} placeholder="EUR" />
          <Input label="Note" value={form.notes} onChange={(v) => setForm({ ...form, notes: v })} placeholder="PAC mensile" />
          <div className="sm:col-span-2 lg:col-span-4">
            <button
              type="submit"
              className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-400"
            >
              Aggiungi
            </button>
          </div>
        </form>
      </SectionCard>

      {/* Posizioni */}
      <SectionCard
        title="Posizioni"
        subtitle={loading ? "aggiornamento prezzi…" : `${positions.length} movimenti registrati`}
        action={
          positions.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                if (window.confirm("Eliminare tutti i movimenti salvati in questo browser?")) {
                  savePositions([]);
                  setMessage("Portafoglio svuotato.");
                }
              }}
              className="text-xs text-base-400 hover:text-fall-500"
            >
              Svuota tutto
            </button>
          ) : undefined
        }
      >
        {positions.length === 0 ? (
          <EmptyState message="Aggiungi il primo movimento per vedere plusvalenze e segnali." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-base-400">
                  <th className="pb-2 text-left font-normal">Titolo</th>
                  <th className="pb-2 text-right font-normal">Qtà</th>
                  <th className="pb-2 text-right font-normal">Carico</th>
                  <th className="pb-2 text-right font-normal">Attuale</th>
                  <th className="pb-2 text-right font-normal">Controvalore</th>
                  <th className="pb-2 text-right font-normal">Plus. totale</th>
                  <th className="pb-2 text-right font-normal">Plus. {new Date().getFullYear()}</th>
                  <th className="pb-2 text-right font-normal">Sale / Scende</th>
                  <th className="pb-2 text-right font-normal">Consiglio</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {computed.map((row) => (
                  <tr key={row.position.id} className="border-t border-base-800">
                    <td className="py-2.5">
                      <Link
                        href={`/titolo/${encodeURIComponent(row.position.symbol)}`}
                        className="font-medium text-base-100 hover:text-accent-400"
                      >
                        {row.position.symbol}
                      </Link>
                      <div className="text-xs text-base-400">
                        {row.position.name}
                        {row.closed && (
                          <span className="ml-1 rounded bg-base-800 px-1 py-0.5 text-[10px] uppercase">
                            chiusa {formatDate(row.position.soldDate)}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-base-400">
                        acquisto {formatDate(row.position.buyDate)}
                        {row.position.fees ? ` · comm. ${formatNumber(row.position.fees, 2)}` : ""}
                      </div>
                    </td>
                    <td className="tabular py-2.5 text-right">{formatNumber(row.position.quantity, 2)}</td>
                    <td className="tabular py-2.5 text-right">
                      {formatPrice(row.position.buyPrice, row.currency)}
                    </td>
                    <td className="tabular py-2.5 text-right">
                      {row.closed
                        ? formatPrice(row.position.soldPrice ?? null, row.currency)
                        : formatPrice(row.price, row.currency)}
                    </td>
                    <td className="tabular py-2.5 text-right">
                      {formatPrice(row.currentValue, row.currency)}
                    </td>
                    <td className={`tabular py-2.5 text-right ${signClass(row.plTotal)}`}>
                      {formatPrice(row.plTotal, row.currency)}
                      <div className="text-xs">{formatPercent(row.plTotalPercent, 2, true)}</div>
                    </td>
                    <td className={`tabular py-2.5 text-right ${signClass(row.plFiscalYear)}`}>
                      {formatPrice(row.plFiscalYear, row.currency)}
                    </td>
                    <td className="py-2.5 text-right">
                      {row.data ? (
                        <div className="flex items-center justify-end gap-2">
                          <span className="tabular text-rise-500">
                            {formatPercent(row.data.analysis.probability.pUp * 100, 0)}
                          </span>
                          <span className="text-base-600">/</span>
                          <span className="tabular text-fall-500">
                            {formatPercent(row.data.analysis.probability.pDown * 100, 0)}
                          </span>
                          <ConfidenceDots confidence={row.data.analysis.probability.confidence} />
                        </div>
                      ) : (
                        <span className="text-base-400">n/d</span>
                      )}
                    </td>
                    <td className="py-2.5 text-right">
                      {row.data ? (
                        <div className="flex flex-col items-end gap-1">
                          <VerdictBadge verdict={row.data.analysis.signal.verdict} />
                          <span className="tabular text-[11px] text-base-400">
                            {row.data.analysis.signal.buy}/{row.data.analysis.signal.sell}/
                            {row.data.analysis.signal.keep}
                          </span>
                        </div>
                      ) : (
                        <span className="text-base-400">n/d</span>
                      )}
                    </td>
                    <td className="py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {!row.closed && (
                          <button
                            type="button"
                            onClick={() => registerSale(row.position)}
                            title="Registra vendita"
                            className="rounded-md border border-base-700 px-2 py-1 text-[11px] text-base-300 hover:border-base-600 hover:text-base-100"
                          >
                            Vendi
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm(`Eliminare il movimento su ${row.position.symbol}?`)) {
                              removePosition(row.position.id);
                            }
                          }}
                          title="Elimina movimento"
                          className="rounded-md p-1 text-base-400 hover:bg-base-800 hover:text-fall-500"
                        >
                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-[11px] leading-relaxed text-base-400">
          La plusvalenza dell&apos;anno in corso considera, per le posizioni aperte prima del 1°
          gennaio, la prima chiusura dell&apos;anno come base di partenza. Per le posizioni chiuse
          conta la differenza realizzata. Il calcolo non sostituisce la documentazione fiscale del
          tuo intermediario.
        </p>
      </SectionCard>
    </div>
  );
}

function Metric({
  label,
  value,
  className = "",
  hint,
}: {
  label: string;
  value: string;
  className?: string;
  hint?: string;
}) {
  return (
    <div title={hint}>
      <div className="text-[11px] uppercase tracking-wide text-base-400">{label}</div>
      <div className={`tabular mt-0.5 text-[15px] font-semibold ${className}`}>{value}</div>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  required = false,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
  inputMode?: "decimal" | "text";
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-wide text-base-400">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        type={type}
        required={required}
        inputMode={inputMode}
        className="w-full rounded-lg border border-base-700 bg-base-900/70 px-3 py-2 text-sm outline-none focus:border-accent-500/60"
      />
    </label>
  );
}
