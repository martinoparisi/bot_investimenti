import assert from "node:assert/strict";
import { test } from "node:test";

import { aggregateSignals, computeSignal, type SignalInput } from "./signal";
import { rng } from "./testing";

const base: SignalInput = {
  pUp: 0.5,
  confidence: 0.7,
  expectedReturn: 0,
  sigmaHorizon: 0.1,
  trend: 0,
  rsi: 50,
  cvar95: -0.02,
  maxDrawdown: -0.2,
};

test("computeSignal: le tre percentuali sommano sempre a 100", () => {
  const u = rng(1234);
  for (let i = 0; i < 2000; i++) {
    const s = computeSignal({
      pUp: u(),
      confidence: u(),
      expectedReturn: u() * 0.4 - 0.2,
      sigmaHorizon: u() * 0.5,
      trend: u() * 2 - 1,
      rsi: u() * 100,
      cvar95: -u() * 0.1,
      maxDrawdown: -u(),
    });
    assert.equal(s.buy + s.sell + s.keep, 100);
    assert.ok(s.buy >= 0 && s.sell >= 0 && s.keep >= 0);
  }
});

test("computeSignal: probabilità alta e trend positivo -> Compra", () => {
  const s = computeSignal({
    ...base,
    pUp: 0.72,
    confidence: 0.9,
    expectedReturn: 0.08,
    trend: 0.6,
  });
  assert.equal(s.verdict, "buy");
  assert.ok(s.buy > s.sell && s.buy > s.keep);
});

test("computeSignal: probabilità bassa e trend negativo -> Vendi", () => {
  const s = computeSignal({
    ...base,
    pUp: 0.28,
    confidence: 0.9,
    expectedReturn: -0.08,
    trend: -0.6,
  });
  assert.equal(s.verdict, "sell");
});

test("computeSignal: bassa affidabilità spinge su Mantieni", () => {
  const sicuro = computeSignal({ ...base, pUp: 0.6, confidence: 0.95, trend: 0.3 });
  const incerto = computeSignal({ ...base, pUp: 0.6, confidence: 0.05, trend: 0.3 });
  assert.ok(incerto.keep > sicuro.keep, `${incerto.keep} vs ${sicuro.keep}`);
  assert.equal(incerto.verdict, "keep");
});

test("computeSignal: simmetria fra rialzo e ribasso a parità di rischio", () => {
  // A rischio azzerato le due utilità sono speculari: solo i termini di coda
  // (CVaR e drawdown) rompono la simmetria, ed è voluto.
  const senzaRischio = { ...base, cvar95: 0, maxDrawdown: 0 };
  const su = computeSignal({ ...senzaRischio, pUp: 0.65, expectedReturn: 0.05, trend: 0.4 });
  const giu = computeSignal({ ...senzaRischio, pUp: 0.35, expectedReturn: -0.05, trend: -0.4 });
  assert.ok(Math.abs(su.buy - giu.sell) <= 1, `${su.buy} vs ${giu.sell}`);
});

test("computeSignal: il rischio di coda rompe la simmetria a favore di Vendi", () => {
  const su = computeSignal({ ...base, pUp: 0.65, expectedReturn: 0.05, trend: 0.4 });
  const giu = computeSignal({ ...base, pUp: 0.35, expectedReturn: -0.05, trend: -0.4 });
  assert.ok(giu.sell > su.buy, `${giu.sell} vs ${su.buy}`);
});

test("computeSignal: rsi nullo non rompe il calcolo", () => {
  const s = computeSignal({ ...base, rsi: null });
  assert.equal(s.buy + s.sell + s.keep, 100);
});

test("computeSignal: coda di perdita pesante aumenta Vendi", () => {
  const normale = computeSignal({ ...base, cvar95: -0.01 });
  const pesante = computeSignal({ ...base, cvar95: -0.08 });
  assert.ok(pesante.sell > normale.sell);
});

test("aggregateSignals: media pesata, somma 100", () => {
  const senzaRischio = { ...base, cvar95: 0, maxDrawdown: 0 };
  const compra = computeSignal({ ...senzaRischio, pUp: 0.75, confidence: 0.9, trend: 0.5 });
  const vendi = computeSignal({ ...senzaRischio, pUp: 0.25, confidence: 0.9, trend: -0.5 });

  const soloCompra = aggregateSignals([
    { signal: compra, weight: 1000 },
    { signal: vendi, weight: 1 },
  ]);
  assert.equal(soloCompra.buy + soloCompra.sell + soloCompra.keep, 100);
  assert.equal(soloCompra.verdict, "buy");

  const bilanciato = aggregateSignals([
    { signal: compra, weight: 1 },
    { signal: vendi, weight: 1 },
  ]);
  assert.ok(Math.abs(bilanciato.buy - bilanciato.sell) <= 1);
});

test("aggregateSignals: portafoglio vuoto -> Mantieni al 100%", () => {
  const s = aggregateSignals([]);
  assert.deepEqual([s.buy, s.sell, s.keep], [0, 0, 100]);
});
