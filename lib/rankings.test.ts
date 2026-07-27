/**
 * La dashboard non deve più aspettare Yahoo: se in cache c'è qualcosa da
 * mostrare, `getRankings` risponde subito e il ricalcolo resta in background.
 *
 * Il test gira senza DATABASE_URL, quindi `db.ts` usa la cache in memoria.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { getRankings } from "./rankings";
import { saveSnapshots, type StoredSnapshot } from "./db";
import { constituentsOf } from "./data/universe";

const PERIOD = "1m" as const;

function fakeSnapshot(symbol: string, computedAt: number): StoredSnapshot {
  return {
    symbol,
    period: PERIOD,
    computedAt,
    metrics: {
      symbol,
      name: symbol,
      currency: "EUR",
      price: 10,
      changePercent: 0,
      periodChangePercent: 0,
      pUp: 0.5,
      pDown: 0.5,
      confidence: 0.5,
      buy: 33,
      sell: 33,
      keep: 34,
      verdict: "keep",
      volatilityAnnual: 20,
      expectedReturnPercent: 0,
      sparkline: [10],
      computedAt,
    },
  };
}

test("con snapshot in cache risponde senza aspettare il ricalcolo", async () => {
  const symbols = constituentsOf("ftse-mib").map((c) => c.symbol);
  const now = Date.now();

  // Tutti freschi tranne il primo, che è scaduto e va rianalizzato.
  await saveSnapshots(
    symbols.map((s, i) => fakeSnapshot(s, i === 0 ? now - 24 * 60 * 60 * 1000 : now)),
  );

  const started = Date.now();
  const result = await getRankings("ftse-mib", PERIOD, { maxLazyRefresh: 1 });
  const elapsed = Date.now() - started;

  assert.ok(elapsed < 500, `risposta in ${elapsed}ms: sta ancora aspettando l'analisi`);
  assert.equal(result.items.length, symbols.length);
  assert.equal(result.pending, 1);
  assert.ok(result.pendingRefresh, "il lotto scaduto deve partire in background");

  // Una seconda richiesta ravvicinata riusa lo stesso lotto invece di
  // rianalizzare gli stessi titoli.
  const second = await getRankings("ftse-mib", PERIOD, { maxLazyRefresh: 1 });
  assert.equal(second.pendingRefresh, result.pendingRefresh);

  // Il lotto tocca la rete: qui non interessa l'esito, solo non lasciarlo appeso.
  await result.pendingRefresh?.catch(() => {});
});
