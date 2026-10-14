/** Port of backend/experimentos/stats/sequential.py: peeking vs group-sequential boundaries, by simulation. */
import { normPpf, rng } from "./math";

export function simulateSequential(nLooks = 10, alpha = 0.05, powerTarget = 0.8, sims = 30_000, seed = 20240612) {
  if (!(nLooks >= 1 && nLooks <= 50)) throw new Error("n_looks must be between 1 and 50");
  const g = rng(seed);
  const t = Array.from({ length: nLooks }, (_, k) => (k + 1) / nLooks);
  const zFixed = normPpf(1 - alpha / 2);
  const drift = zFixed + normPpf(powerTarget);

  // z statistic paths at equally spaced looks: B(t)/sqrt(t) with drift theta*t.
  const paths = (k: number, theta: number, n: number) => {
    const tt = Array.from({ length: k }, (_, i) => (i + 1) / k);
    const out = new Float64Array(n * k);
    for (let s = 0; s < n; s++) {
      let b = 0;
      let prev = 0;
      for (let i = 0; i < k; i++) {
        b += g.normal() * Math.sqrt(tt[i] - prev);
        prev = tt[i];
        out[s * k + i] = (b + theta * tt[i]) / Math.sqrt(tt[i]);
      }
    }
    return out;
  };
  const shapes: Record<string, number[]> = {
    naive: t.map(() => 1),
    pocock: t.map(() => 1),
    obrien_fleming: t.map((_, i) => Math.sqrt(nLooks / (i + 1))),
  };
  // Calibrate a boundary c * shape so that P(any |z_k| >= c * shape_k) = alpha under H0.
  const calibrate = (shape: number[], nullPaths: Float64Array) => {
    const ratios = new Float64Array(sims);
    for (let s = 0; s < sims; s++) {
      let m = 0;
      for (let i = 0; i < nLooks; i++) m = Math.max(m, Math.abs(nullPaths[s * nLooks + i]) / shape[i]);
      ratios[s] = m;
    }
    const fpr = (c: number) => {
      let n = 0;
      for (let s = 0; s < sims; s++) if (ratios[s] >= c) n++;
      return n / sims;
    };
    let lo = 0.5;
    let hi = 10;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (fpr(mid) <= alpha) hi = mid;
      else lo = mid;
    }
    return shape.map((x) => hi * x);
  };
  const nullPaths = paths(nLooks, 0, sims);
  const alt = paths(nLooks, drift, sims);
  const bounds: Record<string, number[]> = {
    naive: t.map(() => zFixed),
    pocock: calibrate(shapes.pocock, nullPaths),
    obrien_fleming: calibrate(shapes.obrien_fleming, nullPaths),
  };
  const labels: Record<string, string> = {
    naive: "Peek every time at the fixed-horizon threshold",
    pocock: "Pocock boundary (constant threshold)",
    obrien_fleming: "O'Brien-Fleming boundary (strict early, lenient late)",
  };
  const designs = Object.keys(bounds).map((id) => {
    const bound = bounds[id];
    const fresh = paths(nLooks, 0, sims);
    let rejected = 0;
    let stopped = 0;
    let used = 0;
    const stopBy = new Array(nLooks).fill(0);
    for (let s = 0; s < sims; s++) {
      for (let i = 0; i < nLooks; i++) if (Math.abs(fresh[s * nLooks + i]) >= bound[i]) { rejected++; break; }
      let first = -1;
      for (let i = 0; i < nLooks; i++) if (Math.abs(alt[s * nLooks + i]) >= bound[i]) { first = i; break; }
      if (first >= 0) {
        stopped++;
        for (let i = first; i < nLooks; i++) stopBy[i]++;
      }
      used += (first >= 0 ? first + 1 : nLooks) / nLooks;
    }
    return {
      id, name: labels[id], boundary_z: bound, false_positive_rate: rejected / sims, power: stopped / sims,
      expected_sample_fraction: used / sims, stop_by_look: stopBy.map((x) => x / sims),
    };
  });
  const naiveCurve = Array.from(new Set([1, 2, 3, 5, 10, 20, 30, 50, nLooks])).sort((a, b) => a - b).map((k) => {
    const n = Math.floor(sims / 2);
    const p = paths(k, 0, n);
    let hits = 0;
    for (let s = 0; s < n; s++) for (let i = 0; i < k; i++) if (Math.abs(p[s * k + i]) >= zFixed) { hits++; break; }
    return { looks: k, false_positive_rate: hits / n };
  });
  return {
    inputs: { n_looks: nLooks, alpha, power: powerTarget, sims, seed },
    designs,
    naive_fpr_by_looks: naiveCurve,
    fixed_horizon_z: zFixed,
    method: "Monte Carlo of the z-statistic path at equally spaced looks (Brownian motion approximation). Boundaries are calibrated to the overall alpha on one simulated null sample and evaluated on another.",
    note: "A design simulation, not a re-analysis of the Criteo data, which has no timestamps. Computed in your browser.",
  };
}
