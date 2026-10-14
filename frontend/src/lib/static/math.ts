/** Numerical helpers shared by the in-browser calculators (ports of the Python stats code). */

/** Standard normal CDF, Hart (1968) algorithm 5666 as implemented by West (2005); ~1e-14 accuracy. */
export function normCdf(x: number): number {
  const a = Math.abs(x);
  let c: number;
  if (a > 37) c = 0;
  else {
    const e = Math.exp((-a * a) / 2);
    if (a < 7.07106781186547) {
      let b = 3.52624965998911e-2 * a + 0.700383064443688;
      b = b * a + 6.37396220353165;
      b = b * a + 33.912866078383;
      b = b * a + 112.079291497871;
      b = b * a + 221.213596169931;
      b = b * a + 220.206867912376;
      c = e * b;
      b = 8.83883476483184e-2 * a + 1.75566716318264;
      b = b * a + 16.064177579207;
      b = b * a + 86.7807322029461;
      b = b * a + 296.564248779674;
      b = b * a + 637.333633378831;
      b = b * a + 793.826512519948;
      b = b * a + 440.413735824752;
      c = c / b;
    } else {
      let b = a + 0.65;
      b = a + 4 / b;
      b = a + 3 / b;
      b = a + 2 / b;
      b = a + 1 / b;
      c = e / b / 2.506628274631;
    }
  }
  return x > 0 ? 1 - c : c;
}

/** Inverse standard normal CDF: Acklam's rational approximation plus one Halley refinement step. */
export function normPpf(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  let x: number;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= 1 - lo) {
    const q = p - 0.5;
    const r = q * q;
    x = ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const e = normCdf(x) - p;
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  return x - u / (1 + (x * u) / 2);
}

/** numpy.quantile(..., method="linear") on an already sorted array. */
export function quantileSorted(sorted: ArrayLike<number>, q: number): number {
  const n = sorted.length;
  const h = (n - 1) * q;
  const lo = Math.floor(h);
  const hi = Math.min(n - 1, lo + 1);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

/** Number of elements strictly greater than t in a sorted array. */
export function countAbove(sorted: ArrayLike<number>, t: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] > t) hi = mid;
    else lo = mid + 1;
  }
  return sorted.length - lo;
}

/** Python's round(): round half to even. */
export function pyRound(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/** Seeded PRNG (mulberry32) with Box-Muller normals; deterministic across browsers. */
export function rng(seed: number) {
  let s = seed >>> 0;
  const uniform = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let spare: number | null = null;
  const normal = () => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u = 0;
    while (u === 0) u = uniform();
    const v = uniform();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };
  return { uniform, normal };
}

/** Python-style number formatting used by the generated brief. */
export const py = {
  num: (x: number | null | undefined, d = 0) => (x == null ? "n/a" : x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })),
  pct: (x: number | null | undefined, d = 2) => (x == null ? "n/a" : `${(x * 100).toFixed(d)}%`),
  pp: (x: number | null | undefined, d = 3) => (x == null ? "n/a" : `${x >= 0 ? "+" : "-"}${Math.abs(x * 100).toFixed(d)} pp`),
  pval: (p: number | null | undefined) => (p == null ? "n/a" : p < 1e-4 ? "< 0.0001" : p.toFixed(4)),
};
