import assert from "node:assert/strict";
import { test } from "node:test";

import { atr, bollinger, ema, last, macd, momentum, obv, rsi, sma } from "./indicators";
import {
  beta,
  conditionalVaR,
  ewmaVol,
  historicalVaR,
  logReturns,
  maxDrawdown,
  pairedLogReturns,
  sharpe,
  shrunkDrift,
  stdev,
} from "./returns";
import { gbmSeries } from "./testing";

test("sma: media mobile su valori noti", () => {
  const values = [1, 2, 3, 4, 5];
  const out = sma(values, 3);
  assert.ok(Number.isNaN(out[0]) && Number.isNaN(out[1]));
  assert.equal(out[2], 2);
  assert.equal(out[3], 3);
  assert.equal(out[4], 4);
});

test("ema: prima uscita è la SMA di inizializzazione, poi segue la formula", () => {
  const values = [1, 2, 3, 4, 5];
  const out = ema(values, 3);
  assert.equal(out[2], 2); // (1+2+3)/3
  const k = 2 / 4;
  assert.ok(Math.abs(out[3] - (4 * k + 2 * (1 - k))) < 1e-12);
});

test("rsi: serie monotona crescente satura a 100, decrescente a 0", () => {
  const up = Array.from({ length: 40 }, (_, i) => 100 + i);
  const down = Array.from({ length: 40 }, (_, i) => 100 - i);
  assert.equal(last(rsi(up, 14)), 100);
  assert.equal(last(rsi(down, 14)), 0);
});

test("rsi: valore intermedio su serie alternata resta vicino a 50", () => {
  const alt = Array.from({ length: 60 }, (_, i) => 100 + (i % 2 === 0 ? 0 : 1));
  const value = last(rsi(alt, 14));
  assert.ok(value !== null && value > 40 && value < 60, `rsi=${value}`);
});

test("macd: histogram = macd - signal dove entrambi definiti", () => {
  const closes = gbmSeries(200, 0.0004, 0.012, 7);
  const { macd: line, signal, histogram } = macd(closes);
  const i = closes.length - 1;
  assert.ok(Number.isFinite(histogram[i]));
  assert.ok(Math.abs(histogram[i] - (line[i] - signal[i])) < 1e-12);
});

test("bollinger: percentB a 0.5 su serie costante, prezzo dentro le bande", () => {
  const flat = new Array(50).fill(10);
  const { percentB, upper, lower } = bollinger(flat);
  assert.equal(percentB[49], 0.5);
  assert.equal(upper[49], 10);
  assert.equal(lower[49], 10);
});

test("atr: su range giornaliero costante converge al range stesso", () => {
  const n = 60;
  const highs = new Array(n).fill(11);
  const lows = new Array(n).fill(9);
  const closes = new Array(n).fill(10);
  const value = last(atr(highs, lows, closes, 14));
  assert.ok(value !== null && Math.abs(value - 2) < 1e-9, `atr=${value}`);
});

test("obv: accumula il volume secondo la direzione del prezzo", () => {
  const closes = [10, 11, 10, 12];
  const volumes = [100, 200, 300, 400];
  assert.deepEqual(obv(closes, volumes), [0, 200, -100, 300]);
});

test("momentum: rendimento sulla finestra", () => {
  const closes = [100, 100, 100, 110];
  assert.ok(Math.abs(momentum(closes, 3)[3] - 0.1) < 1e-12);
});

test("logReturns: additivi nel tempo", () => {
  const closes = [100, 110, 99];
  const r = logReturns(closes);
  assert.ok(Math.abs(r[0] + r[1] - Math.log(99 / 100)) < 1e-12);
});

test("ewmaVol: recupera la volatilità vera di una serie GBM", () => {
  const trueVol = 0.02;
  const closes = gbmSeries(3000, 0, trueVol, 11);
  const est = ewmaVol(logReturns(closes));
  assert.ok(Math.abs(est - trueVol) < 0.006, `ewmaVol=${est}`);
});

test("stdev: coerente con la volatilità di una serie GBM", () => {
  const closes = gbmSeries(4000, 0, 0.015, 3);
  const est = stdev(logReturns(closes));
  assert.ok(Math.abs(est - 0.015) < 0.002, `stdev=${est}`);
});

test("shrunkDrift: attenua verso zero e mantiene il segno", () => {
  const returns = new Array(252).fill(0.001);
  const shrunk = shrunkDrift(returns);
  assert.ok(shrunk > 0);
  assert.ok(shrunk < 0.001);
  assert.ok(Math.abs(shrunk - 0.0005) < 1e-9); // n/(n+252) = 1/2
});

test("maxDrawdown: individua picco e minimo corretti", () => {
  const closes = [100, 120, 60, 80];
  const { maxDrawdown: dd, peakIndex, troughIndex } = maxDrawdown(closes);
  assert.ok(Math.abs(dd - -0.5) < 1e-12);
  assert.equal(peakIndex, 1);
  assert.equal(troughIndex, 2);
});

test("VaR e CVaR: CVaR non è mai migliore del VaR", () => {
  const closes = gbmSeries(1000, 0, 0.02, 5);
  const returns = logReturns(closes);
  const v = historicalVaR(returns, 0.95);
  const c = conditionalVaR(returns, 0.95);
  assert.ok(v < 0 && c <= v, `var=${v} cvar=${c}`);
});

test("sharpe: positivo su serie con drift positivo, nullo su serie piatta", () => {
  const up = gbmSeries(1500, 0.0008, 0.01, 9);
  assert.ok(sharpe(logReturns(up)) > 0);
  assert.equal(sharpe(new Array(100).fill(0)), 0);
});

test("pairedLogReturns: tiene solo le date presenti in entrambe le serie", () => {
  const times = [10, 20, 30, 40];
  const closes = [100, 110, 121, 133.1];
  // Al benchmark manca la data 30 e ne avanza una che il titolo non ha.
  const benchmark = new Map([
    [5, 50],
    [10, 200],
    [20, 220],
    [40, 242],
  ]);
  const { asset, benchmark: bench } = pairedLogReturns(times, closes, benchmark);
  assert.equal(asset.length, 2);
  assert.equal(bench.length, 2);
  assert.ok(Math.abs(asset[0] - Math.log(110 / 100)) < 1e-12);
  assert.ok(Math.abs(bench[0] - Math.log(220 / 200)) < 1e-12);
});

test("pairedLogReturns: beta corretto anche con una seduta sfasata", () => {
  // Il benchmark ha una barra in più all'inizio: allineando dalla coda il beta
  // crollerebbe, allineando per data resta 2.
  const times = Array.from({ length: 300 }, (_, i) => i + 1);
  const closes = gbmSeries(300, 0.0002, 0.02, 101);
  const benchClosesFull = [50, ...closes.map((c) => Math.sqrt(c) * 10)];
  const benchmark = new Map(benchClosesFull.map((c, i) => [i, c]));

  const { asset, benchmark: bench } = pairedLogReturns(times, closes, benchmark);
  // sqrt(prezzo) dimezza i log-rendimenti, quindi il beta atteso è 2.
  assert.ok(Math.abs((beta(asset, bench) ?? 0) - 2) < 1e-6, `beta=${beta(asset, bench)}`);
});

test("beta: vale 1 contro se stesso e 2 contro una serie a leva doppia", () => {
  const closes = gbmSeries(500, 0.0002, 0.012, 13);
  const r = logReturns(closes);
  const leveraged = r.map((x) => 2 * x);
  assert.ok(Math.abs((beta(r, r) ?? 0) - 1) < 1e-9);
  assert.ok(Math.abs((beta(leveraged, r) ?? 0) - 2) < 1e-9);
});
