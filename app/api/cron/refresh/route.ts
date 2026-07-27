import { NextResponse } from "next/server";

import { analyzeMany } from "@/lib/analysis";
import { parsePeriod } from "@/lib/analytics/periods";
import { constituentsOf, parseIndexId } from "@/lib/data/universe";
import { hasDatabase } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Ricalcola gli snapshot di analisi.
 *
 *   GET/POST /api/cron/refresh?index=sp-500&period=1m&offset=0&limit=150
 *   Authorization: Bearer $CRON_SECRET
 *
 * Il lotto è volutamente limitato: le funzioni serverless hanno un tetto di
 * durata, quindi lo scheduler chiama l'endpoint più volte con offset diversi
 * invece di provare a fare tutto in una volta.
 */
async function handle(request: Request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  // Vercel Cron aggiunge da sé l'header con CRON_SECRET; le chiamate esterne
  // (GitHub Actions) devono farlo esplicitamente.
  if (!secret || header !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "non autorizzato" }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const indexId = parseIndexId(params.get("index"));
  const period = parsePeriod(params.get("period"));
  const offset = Math.max(0, Number(params.get("offset") ?? 0) || 0);
  const limit = Math.min(300, Math.max(1, Number(params.get("limit") ?? 150) || 150));

  const all = constituentsOf(indexId).map((c) => c.symbol);
  const batch = all.slice(offset, offset + limit);
  const started = Date.now();

  if (batch.length === 0) {
    return NextResponse.json({ done: true, index: indexId, period, offset, analyzed: 0 });
  }

  // `analyzeMany` salva ogni titolo appena è pronto: se la funzione viene
  // troncata a metà lotto, i titoli già calcolati restano nel database.
  const { analyses, failed } = await analyzeMany(batch, period);

  return NextResponse.json({
    index: indexId,
    period,
    offset,
    requested: batch.length,
    analyzed: analyses.length,
    failed,
    nextOffset: offset + limit < all.length ? offset + limit : null,
    persisted: hasDatabase(),
    elapsedMs: Date.now() - started,
  });
}

export const GET = handle;
export const POST = handle;
