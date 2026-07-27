import { NextResponse } from "next/server";

import { PERIODS, parsePeriod } from "@/lib/analytics/periods";
import { fetchChart } from "@/lib/data/yahoo";

export const runtime = "nodejs";

/** GET /api/chart?symbol=ISP.MI&period=1m */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const symbol = params.get("symbol")?.trim();
  if (!symbol) return NextResponse.json({ error: "parametro symbol mancante" }, { status: 400 });

  const period = parsePeriod(params.get("period"));
  const def = PERIODS[period];

  try {
    // Intraday: 30 secondi di cache. Giornaliero o superiore: 5 minuti.
    const revalidate = def.chartInterval.endsWith("m") ? 30 : 300;
    const chart = await fetchChart(symbol, def.chartRange, def.chartInterval, revalidate);
    return NextResponse.json(
      { symbol, period, ...chart },
      {
        headers: {
          "Cache-Control": `public, s-maxage=${revalidate}, stale-while-revalidate=${revalidate * 4}`,
        },
      },
    );
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
