-- Schema per Neon Postgres.
-- Eseguilo una volta nel SQL Editor di Neon (console.neon.tech → SQL Editor),
-- oppure con: psql "$DATABASE_URL" -f db/schema.sql
--
-- Il database è opzionale: senza, l'app funziona con una cache in memoria.
-- Con Neon le classifiche precalcolate sopravvivono ai riavvii e le funzioni
-- serverless di Vercel non devono ricalcolare 750 titoli a ogni richiesta.

-- Anagrafica: serve soprattutto a non richiedere due volte lo stesso ISIN
-- (le API gratuite che lo forniscono hanno limiti giornalieri bassi).
CREATE TABLE IF NOT EXISTS instrument (
  symbol      TEXT PRIMARY KEY,
  name        TEXT,
  isin        TEXT,
  index_code  TEXT,
  currency    TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS instrument_isin_idx ON instrument (isin);

-- Risultato dell'analisi per (titolo, periodo). Una riga per combinazione:
-- il refresh sovrascrive, non accumula storia.
CREATE TABLE IF NOT EXISTS analysis_snapshot (
  symbol      TEXT NOT NULL,
  period      TEXT NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metrics     JSONB NOT NULL,
  PRIMARY KEY (symbol, period)
);

CREATE INDEX IF NOT EXISTS analysis_snapshot_period_idx
  ON analysis_snapshot (period, computed_at DESC);

-- Cache delle chiusure giornaliere. Opzionale: riduce le chiamate a Yahoo
-- quando si ricalcolano molti titoli di seguito.
CREATE TABLE IF NOT EXISTS ohlc_daily (
  symbol  TEXT NOT NULL,
  d       DATE NOT NULL,
  open    DOUBLE PRECISION,
  high    DOUBLE PRECISION,
  low     DOUBLE PRECISION,
  close   DOUBLE PRECISION NOT NULL,
  volume  DOUBLE PRECISION,
  PRIMARY KEY (symbol, d)
);
