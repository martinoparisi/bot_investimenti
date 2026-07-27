import { NextResponse, after } from "next/server";

import { parsePeriod } from "@/lib/analytics/periods";
import { parseIndexId } from "@/lib/data/universe";
import { getRankings, toDashboard } from "@/lib/rankings";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** GET /api/classifiche?index=ftse-mib&period=1m&watch=ISP.MI,ENI.MI — dati della dashboard. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const indexId = parseIndexId(params.get("index"));
  const period = parsePeriod(params.get("period"));
  const lazy = Number(params.get("lazy") ?? 12);
  const watch = new Set((params.get("watch") ?? "").split(",").filter(Boolean));

  try {
    const { pendingRefresh, ...rankings } = await getRankings(indexId, period, {
      maxLazyRefresh: Number.isFinite(lazy) ? Math.min(Math.max(lazy, 0), 40) : 12,
    });

    // Il lotto di ricalcolo continua dopo la risposta: il client non aspetta.
    if (pendingRefresh) after(pendingRefresh);

    const dashboard = toDashboard(rankings);

    // `items` serviva solo a rifornire i "mercati seguiti": spedire tutti i 750
    // titoli (sparkline incluse) a ogni polling costava centinaia di kB inutili.
    return NextResponse.json({
      index: indexId,
      period,
      ...dashboard,
      items: dashboard.items.filter((s) => watch.has(s.symbol)),
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
