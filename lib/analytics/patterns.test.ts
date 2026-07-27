import assert from "node:assert/strict";
import { test } from "node:test";

import { detectPatterns, patternAnalysis, pivots } from "./patterns";
import { gbmSeries, rng } from "./testing";

/** Candele sintetiche da una serie di chiusure: range fisso attorno alla chiusura. */
function candlesFrom(closes: number[], volume = 1000): {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}[] {
  return closes.map((c, i) => ({
    time: 1_600_000_000 + i * 86_400,
    open: i > 0 ? closes[i - 1] : c,
    high: c * 1.005,
    low: c * 0.995,
    close: c,
    volume,
  }));
}

/** Segmento lineare fra due prezzi, estremo iniziale escluso. */
function ramp(from: number, to: number, steps: number): number[] {
  return Array.from({ length: steps }, (_, i) => from + ((to - from) * (i + 1)) / steps);
}

test("pivots: massimi e minimi riconosciuti solo k barre dopo", () => {
  const closes = [10, 11, 12, 13, 14, 15, 20, 15, 14, 13, 12, 11, 10];
  const found = pivots(closes, closes, 3);
  const high = found.find((p) => p.kind === "high");
  assert.ok(high, "manca il massimo");
  assert.equal(high.index, 6);
  assert.equal(high.confirmedAt, 9);
});

test("patternAnalysis: le feature all'indice i non cambiano se arrivano barre nuove", () => {
  // È il test che protegge dal look-ahead bias: se un pivot venisse usato prima
  // della sua conferma, allungare la serie cambierebbe il passato.
  const closes = gbmSeries(600, 0.0004, 0.015, 7);
  const highs = closes.map((c) => c * 1.008);
  const lows = closes.map((c) => c * 0.992);
  const volumes = closes.map(() => 1000);

  const full = patternAnalysis(highs, lows, closes, volumes);
  const m = 400;
  const prefix = patternAnalysis(
    highs.slice(0, m),
    lows.slice(0, m),
    closes.slice(0, m),
    volumes.slice(0, m),
  );

  for (let i = 0; i < m; i++) {
    assert.equal(prefix.structure[i], full.structure[i], `structure @${i}`);
    assert.equal(prefix.pattern[i], full.pattern[i], `pattern @${i}`);
    assert.equal(prefix.distResistance[i], full.distResistance[i], `distResistance @${i}`);
    assert.equal(prefix.distSupport[i], full.distSupport[i], `distSupport @${i}`);
    assert.equal(prefix.channelSlope[i], full.channelSlope[i], `channelSlope @${i}`);
    assert.equal(prefix.channelR2[i], full.channelR2[i], `channelR2 @${i}`);
  }
});

test("patternAnalysis: nessun NaN e pattern sempre in [-1,1]", () => {
  const u = rng(99);
  for (let s = 0; s < 40; s++) {
    const closes = gbmSeries(300, u() * 0.002 - 0.001, 0.005 + u() * 0.05, s);
    const highs = closes.map((c) => c * (1 + u() * 0.02));
    const lows = closes.map((c) => c * (1 - u() * 0.02));
    const f = patternAnalysis(highs, lows, closes, closes.map(() => 1000));

    for (let i = 0; i < closes.length; i++) {
      for (const [name, series] of Object.entries(f)) {
        if (name === "events") continue;
        const v = (series as number[])[i];
        assert.ok(Number.isFinite(v), `${name} @${i} = ${v}`);
      }
      assert.ok(f.pattern[i] >= -1 && f.pattern[i] <= 1, `pattern @${i} = ${f.pattern[i]}`);
      assert.ok(f.channelR2[i] >= 0 && f.channelR2[i] <= 1);
    }
  }
});

test("detectPatterns: doppio minimo riconosciuto come rialzista", () => {
  // 100 → 80 → 95 → 80 → 105: due minimi allo stesso livello, poi rottura.
  const closes = [
    100,
    ...ramp(100, 80, 20),
    ...ramp(80, 95, 15),
    ...ramp(95, 80, 15),
    ...ramp(80, 105, 25),
  ];
  const found = detectPatterns(candlesFrom(closes));
  const dbl = found.find((p) => p.id === "doubleBottom");
  assert.ok(dbl, `doppio minimo non trovato: ${found.map((p) => p.id).join(", ")}`);
  assert.equal(dbl.direction, "bullish");
  // Neckline = massimo fra i due minimi, cioè il rimbalzo a 95.
  const neckline = dbl.levels.find((l) => l.label === "Neckline");
  assert.ok(neckline && Math.abs(neckline.price - 95) < 2, `neckline = ${neckline?.price}`);
});

test("detectPatterns: testa e spalle riconosciuto come ribassista", () => {
  // Spalla 110, testa 130, spalla 110, poi discesa sotto la neckline.
  const closes = [
    100,
    ...ramp(100, 110, 12),
    ...ramp(110, 95, 12),
    ...ramp(95, 130, 14),
    ...ramp(130, 95, 14),
    ...ramp(95, 110, 12),
    ...ramp(110, 85, 18),
  ];
  const found = detectPatterns(candlesFrom(closes));
  const hs = found.find((p) => p.id === "headShoulders");
  assert.ok(hs, `testa e spalle non trovato: ${found.map((p) => p.id).join(", ")}`);
  assert.equal(hs.direction, "bearish");
  const neckline = hs.levels.find((l) => l.label === "Neckline");
  assert.ok(neckline && Math.abs(neckline.price - 95) < 3, `neckline = ${neckline?.price}`);
});

test("patternAnalysis: trend crescente a onde dà massimi e minimi crescenti", () => {
  // Rialzo con correzioni: senza oscillazioni non esistono punti di svolta.
  const closes = Array.from(
    { length: 200 },
    (_, i) => 100 * Math.exp(0.0012 * i) * (1 + 0.03 * Math.sin(i / 6)),
  );
  const highs = closes.map((c) => c * 1.004);
  const lows = closes.map((c) => c * 0.996);
  const f = patternAnalysis(highs, lows, closes, []);
  const i = closes.length - 1;

  assert.ok(f.structure[i] > 0.5, `structure = ${f.structure[i]}`);
  assert.ok(f.channelSlope[i] > 0.2, `slope = ${f.channelSlope[i]}`);
  // Le correzioni allentano il canale: R² alto ma non da retta perfetta.
  assert.ok(f.channelR2[i] > 0.5, `r2 = ${f.channelR2[i]}`);
});

test("patternAnalysis: serie monotona non ha punti di svolta", () => {
  // Caso limite onesto: senza correzioni non c'è struttura da leggere, e i
  // livelli restano "lontani" invece di essere inventati.
  const closes = Array.from({ length: 200 }, (_, i) => 100 * Math.exp(0.001 * i));
  const f = patternAnalysis(closes, closes, closes, []);
  const i = closes.length - 1;

  assert.equal(f.structure[i], 0);
  assert.equal(f.distResistance[i], 6);
  assert.equal(f.distSupport[i], 6);
  assert.ok(f.channelR2[i] > 0.99);
});
