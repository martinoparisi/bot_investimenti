/**
 * Risoluzione dell'ISIN.
 *
 * Yahoo Finance non espone l'ISIN. L'ordine di ricerca è:
 *   1. liste dei componenti (il FTSE MIB li ha tutti, da Wikipedia)
 *   2. cache su Neon (una volta trovato non si cerca più)
 *   3. Financial Modeling Prep, se la chiave è configurata (250 chiamate/giorno)
 * Se nessuna fonte risponde restituiamo `null` e la UI mostra "n/d".
 */

import { getInstrument, saveInstrumentIsin } from "@/lib/db";
import { lookupConstituent } from "./universe";

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

export function isIsin(value: string): boolean {
  return ISIN_RE.test(value.trim().toUpperCase());
}

async function fetchFromFmp(symbol: string): Promise<string | null> {
  const key = process.env.FMP_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(
      `https://financialmodelingprep.com/api/v3/profile/${encodeURIComponent(symbol)}?apikey=${key}`,
      { next: { revalidate: 86_400 } },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { isin?: string }[];
    const isin = json?.[0]?.isin;
    return isin && isIsin(isin) ? isin.toUpperCase() : null;
  } catch {
    return null;
  }
}

export async function resolveIsin(symbol: string): Promise<string | null> {
  const fromList = lookupConstituent(symbol)?.constituent.isin;
  if (fromList) return fromList;

  const cached = await getInstrument(symbol);
  if (cached?.isin) return cached.isin;

  const fromFmp = await fetchFromFmp(symbol);
  if (fromFmp) await saveInstrumentIsin(symbol, fromFmp);
  return fromFmp;
}
