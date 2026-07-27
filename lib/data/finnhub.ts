/**
 * Finnhub — opzionale, solo mercati USA.
 *
 * Sul piano gratuito i prezzi USA sono in tempo reale (Yahoo li dà ritardati di
 * ~15 minuti), quindi se la chiave è presente usiamo Finnhub per l'ultimo
 * prezzo dei titoli americani. Limite: 60 chiamate/minuto.
 *
 * La chiave resta lato server: non viene mai esposta al browser. Per questo il
 * front-end fa polling verso le nostre route invece di aprire un WebSocket
 * diretto (che richiederebbe di pubblicare la chiave).
 */

const BASE = "https://finnhub.io/api/v1";

export function hasFinnhub(): boolean {
  return Boolean(process.env.FINNHUB_API_KEY);
}

export interface RealtimeQuote {
  price: number;
  previousClose: number;
  open: number;
  high: number;
  low: number;
  timestamp: number;
  source: "finnhub";
}

/** Ultimo prezzo in tempo reale. `null` se la chiave manca o il titolo non è coperto. */
export async function fetchRealtimeQuote(symbol: string): Promise<RealtimeQuote | null> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return null;

  try {
    const res = await fetch(
      `${BASE}/quote?symbol=${encodeURIComponent(symbol)}&token=${key}`,
      { next: { revalidate: 10 } },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      c?: number; d?: number; h?: number; l?: number; o?: number; pc?: number; t?: number;
    };
    if (!json.c || json.c <= 0) return null;
    return {
      price: json.c,
      previousClose: json.pc ?? 0,
      open: json.o ?? 0,
      high: json.h ?? 0,
      low: json.l ?? 0,
      timestamp: (json.t ?? Math.floor(Date.now() / 1000)) * 1000,
      source: "finnhub",
    };
  } catch {
    return null;
  }
}
