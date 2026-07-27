/**
 * Accesso a Neon Postgres.
 *
 * Il database è OPZIONALE: senza `DATABASE_URL` ogni funzione degrada su una
 * cache in memoria del processo. L'app resta usabile (utile in locale e al
 * primo deploy), ma le classifiche precalcolate non sopravvivono al riavvio.
 */

import { neon } from "@neondatabase/serverless";

import type { PeriodId } from "./analytics/periods";

type Sql = ReturnType<typeof neon>;

let client: Sql | null = null;
let initialized = false;

function db(): Sql | null {
  if (!initialized) {
    initialized = true;
    const url = process.env.DATABASE_URL;
    if (url && url.startsWith("postgres")) {
      try {
        client = neon(url);
      } catch (error) {
        console.warn("Neon non inizializzato:", (error as Error).message);
      }
    }
  }
  return client;
}

export function hasDatabase(): boolean {
  return db() !== null;
}

// ---------------------------------------------------------------------------
// Fallback in memoria (usato solo quando DATABASE_URL non è configurata)
// ---------------------------------------------------------------------------

const memorySnapshots = new Map<string, StoredSnapshot>();
const memoryInstruments = new Map<string, InstrumentRow>();

const key = (symbol: string, period: PeriodId) => `${symbol}::${period}`;

// ---------------------------------------------------------------------------
// Snapshot di analisi
// ---------------------------------------------------------------------------

export interface StoredSnapshot {
  symbol: string;
  period: PeriodId;
  computedAt: number;
  metrics: Record<string, unknown>;
}

export async function saveSnapshots(snapshots: StoredSnapshot[]): Promise<void> {
  if (snapshots.length === 0) return;
  const sql = db();
  if (!sql) {
    for (const s of snapshots) memorySnapshots.set(key(s.symbol, s.period), s);
    return;
  }

  // Insert a blocchi: un unico statement con molti valori è più veloce di N
  // round-trip HTTP verso Neon.
  const CHUNK = 100;
  for (let i = 0; i < snapshots.length; i += CHUNK) {
    const chunk = snapshots.slice(i, i + CHUNK);
    const symbols = chunk.map((s) => s.symbol);
    const periods = chunk.map((s) => s.period);
    const computed = chunk.map((s) => new Date(s.computedAt).toISOString());
    const metrics = chunk.map((s) => JSON.stringify(s.metrics));
    try {
      await sql`
        INSERT INTO analysis_snapshot (symbol, period, computed_at, metrics)
        SELECT * FROM UNNEST(
          ${symbols}::text[],
          ${periods}::text[],
          ${computed}::timestamptz[],
          ${metrics}::jsonb[]
        )
        ON CONFLICT (symbol, period) DO UPDATE
          SET computed_at = EXCLUDED.computed_at,
              metrics = EXCLUDED.metrics
      `;
    } catch (error) {
      console.warn("saveSnapshots fallita:", (error as Error).message);
      return;
    }
  }
}

export async function loadSnapshots(
  period: PeriodId,
  symbols?: string[],
): Promise<StoredSnapshot[]> {
  const sql = db();
  if (!sql) {
    const all = [...memorySnapshots.values()].filter((s) => s.period === period);
    return symbols ? all.filter((s) => symbols.includes(s.symbol)) : all;
  }

  try {
    const rows = symbols
      ? await sql`
          SELECT symbol, period, computed_at, metrics
          FROM analysis_snapshot
          WHERE period = ${period} AND symbol = ANY(${symbols}::text[])
        `
      : await sql`
          SELECT symbol, period, computed_at, metrics
          FROM analysis_snapshot
          WHERE period = ${period}
        `;
    return (rows as Record<string, unknown>[]).map((r) => ({
      symbol: r.symbol as string,
      period: r.period as PeriodId,
      computedAt: new Date(r.computed_at as string).getTime(),
      metrics: r.metrics as Record<string, unknown>,
    }));
  } catch (error) {
    console.warn("loadSnapshots fallita:", (error as Error).message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Anagrafica strumenti (serve soprattutto a non richiedere l'ISIN due volte)
// ---------------------------------------------------------------------------

export interface InstrumentRow {
  symbol: string;
  name: string | null;
  isin: string | null;
  currency: string | null;
}

export async function getInstrument(symbol: string): Promise<InstrumentRow | null> {
  const sql = db();
  if (!sql) return memoryInstruments.get(symbol) ?? null;
  try {
    const rows = (await sql`
      SELECT symbol, name, isin, currency FROM instrument WHERE symbol = ${symbol}
    `) as Record<string, unknown>[];
    if (rows.length === 0) return null;
    return {
      symbol: rows[0].symbol as string,
      name: (rows[0].name as string) ?? null,
      isin: (rows[0].isin as string) ?? null,
      currency: (rows[0].currency as string) ?? null,
    };
  } catch {
    return null;
  }
}

export async function saveInstrumentIsin(symbol: string, isin: string): Promise<void> {
  const sql = db();
  if (!sql) {
    const prev = memoryInstruments.get(symbol);
    memoryInstruments.set(symbol, {
      symbol,
      name: prev?.name ?? null,
      isin,
      currency: prev?.currency ?? null,
    });
    return;
  }
  try {
    await sql`
      INSERT INTO instrument (symbol, isin, updated_at)
      VALUES (${symbol}, ${isin}, NOW())
      ON CONFLICT (symbol) DO UPDATE SET isin = EXCLUDED.isin, updated_at = NOW()
    `;
  } catch (error) {
    console.warn("saveInstrumentIsin fallita:", (error as Error).message);
  }
}
