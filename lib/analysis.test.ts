/**
 * `analyzeMany` deve lasciare una riga a database per OGNI simbolo chiesto,
 * anche per quelli che non si scaricano: sono le righe che fanno avanzare la
 * barra della dashboard fino in fondo invece di lasciarla ferma sui delistati.
 *
 * Il test gira senza DATABASE_URL, quindi `db.ts` usa la cache in memoria.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { analyzeMany } from "./analysis";
import { loadSnapshots } from "./db";

test("analyzeMany salva uno snapshot anche per i simboli falliti", async () => {
  const bogus = "ZZ-NON-ESISTE.MI";
  const { failed, snapshots } = await analyzeMany([bogus], "1m");

  assert.deepEqual(failed, [bogus]);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].symbol, bogus, "la chiave deve essere il simbolo richiesto");

  const stored = await loadSnapshots("1m", [bogus]);
  assert.equal(stored.length, 1, "lo snapshot deve essere già salvato, non a fine lotto");
  assert.equal(stored[0].metrics.failed, true);
});
