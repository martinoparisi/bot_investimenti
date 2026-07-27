"use client";

import { useEffect, useRef, useState } from "react";

import { PERIODS, type PeriodId } from "@/lib/analytics/periods";
import type { DetectedPattern } from "@/lib/analytics/patterns";
import type { Candle, ChartMeta } from "@/lib/data/yahoo";
import { formatPercent, formatPrice, relativeTime, signClass } from "@/lib/format";

type ChartType = "candele" | "linea";

interface ChartPayload {
  meta: ChartMeta;
  candles: Candle[];
  error?: string;
}

/** Ogni quanto ricaricare il grafico, in base alla granularità del periodo. */
function pollInterval(period: PeriodId): number {
  if (period === "1d") return 15_000;
  if (period === "1w" || period === "1m") return 30_000;
  return 120_000;
}

export function PriceChart({
  symbol,
  period,
  currency,
  pattern,
}: {
  symbol: string;
  period: PeriodId;
  currency: string;
  /** Schema da disegnare: livelli come rette orizzontali, pivot come marker. */
  pattern?: DetectedPattern;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // I riferimenti alle serie sopravvivono ai render: aggiorniamo i dati senza
  // ricreare il grafico, altrimenti a ogni polling perderemmo zoom e posizione.
  const chartRef = useRef<{ chart: unknown; price: unknown; volume: unknown } | null>(null);
  const typeRef = useRef<ChartType>("candele");
  // Rette e marker vanno rimossi prima di ridisegnarli: il polling li
  // accumulerebbe uno sopra l'altro a ogni giro.
  const overlayRef = useRef<{ lines: unknown[]; markers: { setMarkers: (m: never[]) => void } | null }>({
    lines: [],
    markers: null,
  });

  const [type, setType] = useState<ChartType>("candele");
  const [payload, setPayload] = useState<ChartPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  // ---- caricamento dati + polling ----
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch(`/api/chart?symbol=${encodeURIComponent(symbol)}&period=${period}`);
        const json = (await res.json()) as ChartPayload;
        if (cancelled) return;
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        setPayload(json);
        setUpdatedAt(Date.now());
        setError(null);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    };

    void load();
    const timer = setInterval(load, pollInterval(period));
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [symbol, period]);

  // ---- creazione del grafico ----
  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;

    (async () => {
      const container = containerRef.current;
      if (!container) return;
      const lib = await import("lightweight-charts");
      if (disposed || !containerRef.current) return;

      const chart = lib.createChart(container, {
        layout: {
          background: { color: "transparent" },
          textColor: "#7b849c",
          attributionLogo: false,
        },
        grid: {
          vertLines: { color: "rgba(34, 39, 53, 0.6)" },
          horzLines: { color: "rgba(34, 39, 53, 0.6)" },
        },
        rightPriceScale: { borderColor: "#222735" },
        timeScale: { borderColor: "#222735", timeVisible: true, secondsVisible: false },
        crosshair: { mode: lib.CrosshairMode.Normal },
        localization: { locale: "it-IT" },
        height: 420,
        autoSize: true,
      });

      const price =
        typeRef.current === "candele"
          ? chart.addSeries(lib.CandlestickSeries, {
              upColor: "#16c784",
              downColor: "#ea3943",
              borderUpColor: "#16c784",
              borderDownColor: "#ea3943",
              wickUpColor: "#16c784",
              wickDownColor: "#ea3943",
            })
          : chart.addSeries(lib.AreaSeries, {
              lineColor: "#4d7cff",
              topColor: "rgba(77, 124, 255, 0.28)",
              bottomColor: "rgba(77, 124, 255, 0.02)",
              lineWidth: 2,
            });

      const volume = chart.addSeries(lib.HistogramSeries, {
        priceFormat: { type: "volume" },
        priceScaleId: "volume",
      });
      chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

      chartRef.current = { chart, price, volume };

      cleanup = () => {
        chart.remove();
        chartRef.current = null;
        overlayRef.current = { lines: [], markers: null };
      };
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [type, symbol]);

  // ---- aggiornamento dei dati sulle serie ----
  useEffect(() => {
    const refs = chartRef.current;
    if (!refs || !payload || payload.candles.length === 0) return;

    const price = refs.price as {
      setData: (data: unknown[]) => void;
    };
    const volume = refs.volume as { setData: (data: unknown[]) => void };

    if (type === "candele") {
      price.setData(
        payload.candles.map((c) => ({
          time: c.time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        })),
      );
    } else {
      price.setData(payload.candles.map((c) => ({ time: c.time, value: c.close })));
    }

    volume.setData(
      payload.candles.map((c) => ({
        time: c.time,
        value: c.volume,
        color: c.close >= c.open ? "rgba(22, 199, 132, 0.32)" : "rgba(234, 57, 67, 0.32)",
      })),
    );
  }, [payload, type]);

  // ---- schema grafico: livelli e punti di svolta ----
  useEffect(() => {
    const refs = chartRef.current;
    if (!refs || !payload) return;
    let cancelled = false;

    const series = refs.price as {
      createPriceLine: (o: Record<string, unknown>) => unknown;
      removePriceLine: (line: unknown) => void;
    };

    // Pulizia di quanto disegnato al giro precedente.
    for (const line of overlayRef.current.lines) series.removePriceLine(line);
    overlayRef.current.lines = [];
    overlayRef.current.markers?.setMarkers([]);

    if (!pattern) return;

    const color = pattern.direction === "bearish" ? "#ea3943" : pattern.direction === "bullish" ? "#16c784" : "#f0b90b";
    overlayRef.current.lines = pattern.levels
      .filter((l) => Number.isFinite(l.price))
      .map((l) =>
        series.createPriceLine({
          price: l.price,
          color,
          lineWidth: 1,
          lineStyle: 2, // tratteggiata
          axisLabelVisible: true,
          title: l.label,
        }),
      );

    // I pivot sono su barre giornaliere: su intervalli intraday o settimanali i
    // loro istanti non esistono nella serie del grafico e i marker sparirebbero
    // o finirebbero nel posto sbagliato.
    if (PERIODS[period].chartInterval !== "1d" || pattern.pivots.length === 0) return;

    void (async () => {
      const lib = await import("lightweight-charts");
      if (cancelled || chartRef.current !== refs) return;
      const markers = pattern.pivots.map((p) => ({
        time: p.time,
        position: p.kind === "high" ? "aboveBar" : "belowBar",
        color,
        shape: p.kind === "high" ? "arrowDown" : "arrowUp",
        size: 1,
      }));
      overlayRef.current.markers = lib.createSeriesMarkers(
        refs.price as Parameters<typeof lib.createSeriesMarkers>[0],
        markers as Parameters<typeof lib.createSeriesMarkers>[1],
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [pattern, payload, period, type]);

  const meta = payload?.meta;
  const changePercent =
    meta && meta.previousClose > 0 ? (meta.regularMarketPrice / meta.previousClose - 1) * 100 : null;

  return (
    <div className="card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <span className="tabular text-2xl font-semibold">
            {formatPrice(meta?.regularMarketPrice ?? null, currency)}
          </span>
          <span className={`tabular text-sm font-medium ${signClass(changePercent)}`}>
            {formatPercent(changePercent, 2, true)}
          </span>
          {meta && (
            <span
              className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                meta.delayed
                  ? "border-hold-500/30 bg-hold-500/10 text-hold-500"
                  : "border-rise-500/30 bg-rise-500/10 text-rise-500"
              }`}
              title={
                meta.delayed
                  ? "Ultimo prezzo più vecchio di 3 minuti: dato ritardato (tipico ~15 min sui mercati europei)"
                  : "Prezzo aggiornato negli ultimi minuti"
              }
            >
              {meta.delayed ? "ritardato" : "live"}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-base-400">agg. {relativeTime(updatedAt)}</span>
          <div className="flex items-center gap-1 rounded-lg border border-base-700 bg-base-900/60 p-0.5">
            {(["candele", "linea"] as ChartType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  typeRef.current = t;
                  setType(t);
                }}
                className={`rounded-md px-2 py-1 text-xs capitalize transition-colors ${
                  type === t ? "bg-base-100 text-base-950" : "text-base-300 hover:text-base-100"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error ? (
        <div className="flex h-[420px] items-center justify-center text-sm text-fall-500">
          Grafico non disponibile: {error}
        </div>
      ) : (
        <div ref={containerRef} className="h-[420px] w-full" />
      )}

      {payload && payload.candles.length === 0 && (
        <p className="mt-2 text-xs text-base-400">
          Nessuna barra disponibile per questo periodo (mercato chiuso o storico assente).
        </p>
      )}
    </div>
  );
}
