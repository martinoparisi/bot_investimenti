import { NextResponse } from "next/server";

import { analyzeSymbol, getBenchmarkSeries } from "@/lib/analysis";
import { parsePeriod } from "@/lib/analytics/periods";
import { resolveIsin } from "@/lib/data/isin";
import { fetchRealtimeQuote, hasFinnhub } from "@/lib/data/finnhub";
import { buildOrderBook } from "@/lib/data/orderbook";
import { benchmarkFor, isUsSymbol } from "@/lib/data/universe";
import { fetchQuote } from "@/lib/data/yahoo";

export const runtime = "nodejs";
export const maxDuration = 60;

/** GET /api/analisi/ISP.MI?period=3m — scheda completa di un titolo. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const { symbol: rawSymbol } = await params;
  const symbol = decodeURIComponent(rawSymbol).toUpperCase();
  const period = parsePeriod(new URL(request.url).searchParams.get("period"));

  try {
    const benchmark = await getBenchmarkSeries(symbol);
    const [analysis, quote, isin] = await Promise.all([
      analyzeSymbol(symbol, period, benchmark),
      fetchQuote(symbol),
      resolveIsin(symbol),
    ]);

    const realtime =
      hasFinnhub() && isUsSymbol(symbol) ? await fetchRealtimeQuote(symbol) : null;

    if (realtime) {
      analysis.price = realtime.price;
      if (realtime.previousClose > 0) {
        analysis.previousClose = realtime.previousClose;
        analysis.changePercent = (realtime.price / realtime.previousClose - 1) * 100;
      }
    }

    return NextResponse.json(
      {
        analysis,
        quote,
        isin,
        orderBook: buildOrderBook(quote),
        benchmarkSymbol: benchmarkFor(symbol),
        priceSource: realtime ? "Finnhub (tempo reale)" : "Yahoo Finance",
        delayed: realtime ? false : true,
      },
      // `max-age` serve al browser: riaprire la stessa scheda titolo entro un
      // minuto non deve rifare l'analisi.
      {
        headers: {
          "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      { error: `Analisi non disponibile per ${symbol}: ${(error as Error).message}` },
      { status: 502 },
    );
  }
}
