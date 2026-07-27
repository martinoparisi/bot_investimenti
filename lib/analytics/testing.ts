/** Generatori deterministici usati dai test (nessuna dipendenza esterna). */

/** PRNG mulberry32: stessa sequenza a parità di seed. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Normale standard via Box-Muller. */
export function normalSampler(seed: number): () => number {
  const u = rng(seed);
  return () => {
    const u1 = Math.max(u(), Number.EPSILON);
    const u2 = u();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
}

/** Serie di prezzi da moto browniano geometrico con drift e vol giornalieri noti. */
export function gbmSeries(
  n: number,
  driftDaily: number,
  volDaily: number,
  seed = 42,
  start = 100,
): number[] {
  const z = normalSampler(seed);
  const out = [start];
  for (let i = 1; i < n; i++) {
    out.push(out[i - 1] * Math.exp(driftDaily - (volDaily * volDaily) / 2 + volDaily * z()));
  }
  return out;
}
