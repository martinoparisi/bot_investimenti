/**
 * Universo analizzato: i quattro indici richiesti e i loro componenti.
 * Le liste vivono in `data/constituents/*.json`, rigenerabili con
 * `npm run constituents`.
 */

import ftseMib from "@/data/constituents/ftse-mib.json";
import ftse100 from "@/data/constituents/ftse-100.json";
import nasdaq100 from "@/data/constituents/nasdaq-100.json";
import sp500 from "@/data/constituents/sp-500.json";

export interface Constituent {
  symbol: string;
  name: string;
  isin: string | null;
  currency: string;
}

export const INDEX_IDS = ["ftse-mib", "ftse-100", "nasdaq-100", "sp-500"] as const;
export type IndexId = (typeof INDEX_IDS)[number];

export interface IndexDef {
  id: IndexId;
  label: string;
  /** Simbolo Yahoo dell'indice stesso. */
  symbol: string;
  currency: string;
  country: string;
  constituents: Constituent[];
}

export const INDEXES: Record<IndexId, IndexDef> = {
  "ftse-mib": {
    id: "ftse-mib",
    label: "FTSE MIB",
    symbol: "FTSEMIB.MI",
    currency: "EUR",
    country: "Italia",
    constituents: ftseMib as Constituent[],
  },
  "ftse-100": {
    id: "ftse-100",
    label: "FTSE 100",
    symbol: "^FTSE",
    currency: "GBp",
    country: "Regno Unito",
    constituents: ftse100 as Constituent[],
  },
  "nasdaq-100": {
    id: "nasdaq-100",
    label: "NASDAQ 100",
    symbol: "^NDX",
    currency: "USD",
    country: "Stati Uniti",
    constituents: nasdaq100 as Constituent[],
  },
  "sp-500": {
    id: "sp-500",
    label: "S&P 500",
    symbol: "^GSPC",
    currency: "USD",
    country: "Stati Uniti",
    constituents: sp500 as Constituent[],
  },
};

export function isIndexId(value: unknown): value is IndexId {
  return typeof value === "string" && (INDEX_IDS as readonly string[]).includes(value);
}

/** `null` significa "tutti gli indici". */
export function parseIndexId(value: unknown): IndexId | null {
  return isIndexId(value) ? value : null;
}

export function constituentsOf(indexId: IndexId | null): Constituent[] {
  if (indexId) return INDEXES[indexId].constituents;
  const seen = new Set<string>();
  const all: Constituent[] = [];
  for (const id of INDEX_IDS) {
    for (const c of INDEXES[id].constituents) {
      if (seen.has(c.symbol)) continue;
      seen.add(c.symbol);
      all.push(c);
    }
  }
  return all;
}

const BY_SYMBOL = new Map<string, { constituent: Constituent; indexId: IndexId }>();
for (const id of INDEX_IDS) {
  for (const c of INDEXES[id].constituents) {
    if (!BY_SYMBOL.has(c.symbol)) BY_SYMBOL.set(c.symbol, { constituent: c, indexId: id });
  }
}

export function lookupConstituent(symbol: string) {
  return BY_SYMBOL.get(symbol.toUpperCase()) ?? null;
}

/** Indice di riferimento per il calcolo del beta di un titolo. */
export function benchmarkFor(symbol: string): string {
  const found = lookupConstituent(symbol);
  if (found) return INDEXES[found.indexId].symbol;
  const upper = symbol.toUpperCase();
  if (upper.endsWith(".MI")) return "FTSEMIB.MI";
  if (upper.endsWith(".L")) return "^FTSE";
  if (upper.endsWith(".DE")) return "^GDAXI";
  if (upper.endsWith(".PA")) return "^FCHI";
  return "^GSPC";
}

/** true per i mercati USA, dove esistono fonti gratuite in tempo reale. */
export function isUsSymbol(symbol: string): boolean {
  return !symbol.includes(".") || symbol.startsWith("^GSPC") || symbol.startsWith("^NDX");
}
