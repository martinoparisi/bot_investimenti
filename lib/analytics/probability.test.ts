import assert from "node:assert/strict";
import { test } from "node:test";

import {
  analyzeProbability,
  brierScore,
  erf,
  gbmInterval,
  gbmProbability,
  normalCdf,
  predictLogistic,
  trainLogistic,
  trendScore,
  wilsonInterval,
} from "./probability";
import { horizonFor, PERIOD_IDS, parsePeriod, tradingDaysLeftInYear } from "./periods";
import { gbmSeries, rng } from "./testing";

test("erf e normalCdf: valori noti", () => {
  // L'approssimazione di Abramowitz & Stegun ha errore massimo ~1.5e-7.
  assert.ok(Math.abs(erf(0)) < 1e-7);
  assert.ok(Math.abs(normalCdf(0) - 0.5) < 1e-7);
  assert.ok(Math.abs(erf(1) - 0.8427008) < 1e-6);
  assert.ok(Math.abs(normalCdf(1.96) - 0.975) < 1e-4);
  assert.ok(Math.abs(normalCdf(-1.96) - 0.025) < 1e-4);
  assert.ok(Math.abs(normalCdf(1) - 0.8413447) < 1e-5);
});

test("gbmProbability: coincide con la formula analitica", () => {
  const mu = 0.0005;
  const sigma = 0.012;
  const h = 21;
  const atteso = normalCdf(((mu - (sigma * sigma) / 2) * h) / (sigma * Math.sqrt(h)));
  assert.ok(Math.abs(gbmProbability(mu, sigma, h) - atteso) < 1e-12);
});

test("gbmProbability: drift nullo dà meno del 50% (correzione di Ito)", () => {
  const p = gbmProbability(0, 0.02, 252);
  assert.ok(p < 0.5 && p > 0.4, `p=${p}`);
});

test("gbmProbability: casi degeneri restituiscono 0.5", () => {
  assert.equal(gbmProbability(0.001, 0, 10), 0.5);
  assert.equal(gbmProbability(0.001, 0.01, 0), 0.5);
});

test("gbmInterval: contiene la stima puntuale e si stringe con più dati", () => {
  const mu = 0.0006;
  const sigma = 0.013;
  const h = 21;
  const p = gbmProbability(mu, sigma, h);

  const pochi = gbmInterval(mu, sigma, h, 60);
  const molti = gbmInterval(mu, sigma, h, 2000);
  assert.ok(pochi[0] <= p && p <= pochi[1]);
  assert.ok(molti[0] <= p && p <= molti[1]);
  assert.ok(molti[1] - molti[0] < pochi[1] - pochi[0]);
  assert.ok(molti[0] >= 0 && molti[1] <= 1);
});

test("gbmInterval: casi degeneri restituiscono l'intervallo massimo", () => {
  assert.deepEqual(gbmInterval(0.001, 0, 10, 500), [0, 1]);
  assert.deepEqual(gbmInterval(0.001, 0.01, 10, 1), [0, 1]);
});

test("wilsonInterval: contiene la proporzione e resta dentro [0,1]", () => {
  const [lo, hi] = wilsonInterval(60, 100);
  assert.ok(lo < 0.6 && hi > 0.6);
  assert.ok(lo >= 0 && hi <= 1);

  const [lo2, hi2] = wilsonInterval(10, 10); // caso estremo p = 1
  assert.ok(lo2 > 0.6 && hi2 <= 1, `[${lo2}, ${hi2}]`);
});

test("wilsonInterval: si stringe al crescere del campione", () => {
  const stretto = wilsonInterval(500, 1000);
  const largo = wilsonInterval(5, 10);
  assert.ok(stretto[1] - stretto[0] < largo[1] - largo[0]);
});

test("wilsonInterval copre la frequenza vera su serie simulata", () => {
  // Bernoulli con p = 0.6: l'intervallo al 95% deve contenere 0.6 quasi sempre.
  const u = rng(2024);
  let coperture = 0;
  const prove = 200;
  for (let t = 0; t < prove; t++) {
    let successi = 0;
    const n = 200;
    for (let i = 0; i < n; i++) if (u() < 0.6) successi++;
    const [lo, hi] = wilsonInterval(successi, n);
    if (lo <= 0.6 && hi >= 0.6) coperture++;
  }
  assert.ok(coperture / prove > 0.9, `copertura=${coperture / prove}`);
});

test("brierScore: 0 se perfetto, 0.25 se sempre 50%", () => {
  assert.equal(brierScore([1, 0, 1], [1, 0, 1]), 0);
  assert.ok(Math.abs(brierScore([0.5, 0.5], [1, 0]) - 0.25) < 1e-12);
});

test("regressione logistica: impara una separazione lineare", () => {
  const u = rng(77);
  const X: number[][] = [];
  const y: number[] = [];
  for (let i = 0; i < 400; i++) {
    const a = u() * 2 - 1;
    const b = u() * 2 - 1;
    X.push([a, b]);
    y.push(a + b > 0 ? 1 : 0);
  }
  const model = trainLogistic(X, y, { iterations: 800, learningRate: 1 });
  assert.ok(predictLogistic(model, [0.9, 0.9]) > 0.8);
  assert.ok(predictLogistic(model, [-0.9, -0.9]) < 0.2);
});

test("regressione logistica: input vuoto non esplode", () => {
  const model = trainLogistic([], []);
  assert.equal(predictLogistic(model, [1, 2, 3]), 0.5);
});

test("analyzeProbability: serie con drift forte positivo dà pUp alta", () => {
  const closes = gbmSeries(1500, 0.0012, 0.01, 21);
  const res = analyzeProbability(closes, 63);
  assert.ok(res.pUp > 0.6, `pUp=${res.pUp}`);
  assert.ok(Math.abs(res.pUp + res.pDown - 1) < 1e-12);
  assert.equal(res.degraded, false);
});

test("analyzeProbability: serie con drift negativo dà pUp bassa", () => {
  const closes = gbmSeries(1500, -0.0012, 0.01, 22);
  const res = analyzeProbability(closes, 63);
  assert.ok(res.pUp < 0.4, `pUp=${res.pUp}`);
});

test("analyzeProbability: senza drift resta vicino al 50%", () => {
  const closes = gbmSeries(2000, 0, 0.012, 33);
  const res = analyzeProbability(closes, 21);
  assert.ok(Math.abs(res.pUp - 0.5) < 0.12, `pUp=${res.pUp}`);
});

test("analyzeProbability: intervallo valido e contiene la stima", () => {
  const closes = gbmSeries(1500, 0.0004, 0.015, 44);
  const res = analyzeProbability(closes, 21);
  assert.ok(res.ci95[0] <= res.pUp && res.pUp <= res.ci95[1]);
  assert.ok(res.ci95[0] >= 0 && res.ci95[1] <= 1);
  assert.ok(res.confidence >= 0 && res.confidence <= 1);
});

test("analyzeProbability: i pesi dei componenti sommano a 1", () => {
  const closes = gbmSeries(1500, 0.0003, 0.014, 55);
  const res = analyzeProbability(closes, 21);
  const somma = res.components.reduce((a, c) => a + c.weight, 0);
  assert.ok(Math.abs(somma - 1) < 1e-9, `somma=${somma}`);
  assert.equal(res.components.length, 3);
  for (const c of res.components) {
    assert.ok(c.ci95[0] <= c.pUp && c.pUp <= c.ci95[1], `${c.name} fuori dal suo intervallo`);
  }
});

test("analyzeProbability: l'intervallo non degenera su orizzonti lunghi", () => {
  // Con orizzonte 63 le finestre indipendenti sono poche: se l'incertezza
  // venisse presa solo dalla frequenza storica l'intervallo sarebbe [0,1].
  const closes = gbmSeries(1500, 0.0005, 0.012, 71);
  const res = analyzeProbability(closes, 63);
  assert.ok(res.ci95[1] - res.ci95[0] < 0.9, `ampiezza=${res.ci95[1] - res.ci95[0]}`);
  assert.ok(res.ci95[0] <= res.pUp && res.pUp <= res.ci95[1]);
});

test("analyzeProbability: storia corta viene marcata come degradata", () => {
  const closes = gbmSeries(40, 0.0005, 0.01, 66);
  const res = analyzeProbability(closes, 21);
  assert.equal(res.degraded, true);
  assert.ok(res.pUp >= 0 && res.pUp <= 1);
});

test("analyzeProbability: serie di lunghezza 1 non lancia eccezioni", () => {
  const res = analyzeProbability([100], 5);
  assert.ok(res.pUp >= 0 && res.pUp <= 1);
  assert.equal(res.degraded, true);
});

test("analyzeProbability: campione efficace tiene conto della sovrapposizione", () => {
  const closes = gbmSeries(1000, 0, 0.01, 88);
  const res = analyzeProbability(closes, 100);
  // 899 finestre sovrapposte, ma solo ~9 indipendenti.
  assert.ok(res.effectiveSamples < 20, `n=${res.effectiveSamples}`);
});

test("trendScore: positivo in trend rialzista, negativo in ribassista", () => {
  const su = Array.from({ length: 400 }, (_, i) => 100 * Math.exp(0.001 * i));
  const giu = Array.from({ length: 400 }, (_, i) => 100 * Math.exp(-0.001 * i));
  assert.ok(trendScore(su) > 0.3, `trend=${trendScore(su)}`);
  assert.ok(trendScore(giu) < -0.3, `trend=${trendScore(giu)}`);
});

test("periodi: parsing e orizzonti sempre positivi", () => {
  assert.equal(parsePeriod("3m"), "3m");
  assert.equal(parsePeriod("inventato"), "1m");
  for (const id of PERIOD_IDS) {
    assert.ok(horizonFor(id) >= 1, `${id} ha orizzonte non valido`);
  }
  assert.ok(tradingDaysLeftInYear(new Date("2026-01-01T00:00:00Z")) > 200);
  assert.ok(tradingDaysLeftInYear(new Date("2026-12-30T00:00:00Z")) >= 1);
});
