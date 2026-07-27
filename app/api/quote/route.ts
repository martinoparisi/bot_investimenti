import { NextResponse } from "next/server";

import { fetchRealtimeQuote, hasFinnhub } from "@/lib/data/finnhub";
import { isUsSymbol } from "@/lib/data/universe";
import { fetchQuotes } from "@/lib/data/yahoo";

export const runtime = "nodejs";

/**
 * GET /api/quote?symbols=AAPL,ISP.MI
 *
 * Yahoo per tutti; se è configurata la chiave Finnhub, per i titoli USA il
 * prezzo viene sostituito con quello in tempo reale (Yahoo li dà ritardati).
 */
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("symbols") ?? "";
  const symbols = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 100);

  if (symbols.length === 0) return NextResponse.json({ quotes: [] });

  try {
    const quotes = await fetchQuotes(symbols);

    const enriched = await Promise.all(
      quotes.map(async (q) => {
        const realtime =
          hasFinnhub() && isUsSymbol(q.symbol) ? await fetchRealtimeQuote(q.symbol) : null;
        if (!realtime) return { ...q, realtime: false as const };
        return {
          ...q,
          price: realtime.price,
          previousClose: realtime.previousClose || q.previousClose,
          changePercent: realtime.previousClose
            ? (realtime.price / realtime.previousClose - 1) * 100
            : q.changePercent,
          realtime: true as const,
        };
      }),
    );

    return NextResponse.json(
      { quotes: enriched },
      { headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=30" } },
    );
  } catch (error) {
    return NextResponse.json({ quotes: [], error: (error as Error).message }, { status: 502 });
  }
}
