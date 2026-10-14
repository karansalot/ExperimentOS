/** Port of backend/experimentos/stats/power.py (pooled-null / unpooled-alternative z-test). */
import { normCdf, normPpf } from "./math";

export class DesignError extends Error {}

function check(base: number, delta: number, share: number, alpha: number) {
  if (!(base > 0 && base < 1)) throw new DesignError("base_rate must be strictly between 0 and 1");
  if (!(base + delta > 0 && base + delta < 1)) throw new DesignError("base_rate + effect must stay strictly between 0 and 1");
  if (delta === 0) throw new DesignError("the effect to detect must be non-zero");
  if (!(share > 0 && share < 1)) throw new DesignError("treatment_share must be strictly between 0 and 1");
  if (!(alpha > 0 && alpha < 1)) throw new DesignError("alpha must be strictly between 0 and 1");
}

const unitVar = (base: number, delta: number, r: number) => {
  const p1 = base + delta;
  return (p1 * (1 - p1)) / r + (base * (1 - base)) / (1 - r);
};
const nullVar = (base: number, delta: number, r: number) => {
  const pooled = r * (base + delta) + (1 - r) * base;
  return pooled * (1 - pooled) * (1 / r + 1 / (1 - r));
};

export function power(n: number, base: number, delta: number, r = 0.5, alpha = 0.05): number {
  check(base, delta, r, alpha);
  if (n <= 0) return 0;
  const se0 = Math.sqrt(nullVar(base, delta, r) / n);
  const se1 = Math.sqrt(unitVar(base, delta, r) / n);
  const z = normPpf(1 - alpha / 2);
  const d = Math.abs(delta);
  return normCdf((d - z * se0) / se1) + normCdf((-d - z * se0) / se1);
}

export function requiredSampleSize(base: number, delta: number, r = 0.5, alpha = 0.05, target = 0.8) {
  check(base, delta, r, alpha);
  if (!(target > 0 && target < 1)) throw new DesignError("power must be strictly between 0 and 1");
  const root = normPpf(1 - alpha / 2) * Math.sqrt(nullVar(base, delta, r)) + normPpf(target) * Math.sqrt(unitVar(base, delta, r));
  const n = Math.ceil((root * root) / (delta * delta));
  const nT = Math.ceil(n * r);
  return { n_total: n, n_treatment: nT, n_control: n - nT, achieved_power: power(n, base, delta, r, alpha) };
}

export function minimumDetectableEffect(n: number, base: number, r = 0.5, alpha = 0.05, target = 0.8): number {
  let lo = 0;
  let hi = 1 - base - 1e-9;
  if (power(n, base, hi, r, alpha) < target) return NaN;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (power(n, base, mid, r, alpha) < target) lo = mid;
    else hi = mid;
  }
  return hi;
}

export function plan(base: number, rel: number, r = 0.5, alpha = 0.05, target = 0.8, perDay: number | null = null) {
  const delta = base * rel;
  const need = requiredSampleSize(base, delta, r, alpha, target);
  const balanced = requiredSampleSize(base, delta, 0.5, alpha, target);
  const n = need.n_total;
  const fracs = [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.15, 1.3, 1.5, 1.75, 2.0, 2.5, 3.0];
  const grid = Array.from(new Set(fracs.map((f) => Math.max(100, Math.round(n * f))))).sort((a, b) => a - b);
  return {
    inputs: { base_rate: base, mde_relative: rel, mde_absolute: delta, treatment_share: r, alpha, power: target, users_per_day: perDay },
    required: need,
    balanced_design: balanced,
    allocation_cost: need.n_total / balanced.n_total,
    days_required: perDay ? Math.ceil(n / perDay) : null,
    power_curve: grid.map((g) => ({ n_total: g, power: power(g, base, delta, r, alpha) })),
    allocations: [0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95].map((share) => {
      const x = requiredSampleSize(base, delta, share, alpha, target);
      return { treatment_share: share, ...x, relative_to_balanced: x.n_total / balanced.n_total };
    }),
    test: "Two-sided pooled two-proportion z-test (pooled SE under H0, unpooled SE under H1)",
  };
}
