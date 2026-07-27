import { NextResponse } from "next/server";

import { searchSymbols } from "@/lib/data/yahoo";

export const runtime = "nodejs";

/** GET /api/search?q=intesa — accetta ticker, nome societario e ISIN. */
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 1) return NextResponse.json({ results: [] });

  try {
    const results = await searchSymbols(query);
    return NextResponse.json(
      { results },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
    );
  } catch (error) {
    return NextResponse.json(
      { results: [], error: (error as Error).message },
      { status: 502 },
    );
  }
}
