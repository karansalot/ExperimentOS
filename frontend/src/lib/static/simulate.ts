/** Port of backend/experimentos/simulator/decision.py. Runs entirely in the browser on the static export. */
import { loadBootstrap, loadJson } from "./data";
import { countAbove, pyRound, quantileSorted } from "./math";

export type ScenarioIn = {
  outcome: string; strategy: string; population: number; cost_per_user: number; value_per_outcome: number;
  targeting_pct: number; budget: number | null; risk: string; basis: string;
};

export const RISK_Q: Record<string, number | null> = { conservative: 0.1, moderate: 0.25, neutral: null };
export const RISK_LABELS: Record<string, string> = {
  conservative: "10th percentile of bootstrap profit",
  moderate: "25th percentile of bootstrap profit",
  neutral: "expected profit",
};
const MULTIPLIERS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

export class ScenarioError extends Error {}

type CurveSet = {
  fraction: number[];
  point: Record<string, number[]>;
  boot: Record<string, Float64Array[]>;
  validPoint: Record<string, number[]> | null;
  validBoot: Record<string, Float64Array[]> | null;
  names: Record<string, string>;
  champion: string;
  thresholds: Record<string, (number | null)[]> | null;
  scoreKind: Record<string, string> | null;
  meta: any;
  models: string[];
};

const cache = new Map<string, Promise<CurveSet>>();

export function loadCurves(scope: string, outcome: string, basis: string): Promise<CurveSet> {
  const key = `${scope}|${outcome}|${basis}`;
  if (!cache.has(key)) {
    cache.set(key, (async () => {
      const [curves, models, boot, vboot] = await Promise.all([
        loadJson(`${scope}/raw/curves.json`),
        loadJson(`${scope}/raw/models.json`),
        loadBootstrap(scope, outcome, "test", basis),
        loadBootstrap(scope, outcome, "valid", basis),
      ]);
      const c = curves.data.outcomes[outcome];
      const mo = models.data.outcomes[outcome];
      const ids = Object.keys(c.models);
      const hasValid = !!c.validation && !!vboot;
      return {
        fraction: c.fraction,
        point: Object.fromEntries(ids.map((m) => [m, c.models[m][basis].value])),
        boot: boot!,
        validPoint: hasValid ? Object.fromEntries(ids.map((m) => [m, c.validation.models[m][basis]])) : null,
        validBoot: hasValid ? vboot : null,
        names: Object.fromEntries(mo.models.map((m: any) => [m.id, m.name])),
        champion: mo.champion,
        thresholds: c.score_thresholds ?? null,
        scoreKind: c.score_kind ?? null,
        meta: { ...curves.meta, evaluation_rows: c.n_rows, n_boot: c.n_boot, evaluation_split: c.split },
        models: ids,
      };
    })());
  }
  return cache.get(key)!;
}

function validate(s: ScenarioIn) {
  if (!["visit", "conversion"].includes(s.outcome)) throw new ScenarioError("outcome must be one of ['visit', 'conversion']");
  if (!(s.risk in RISK_Q)) throw new ScenarioError("risk must be one of conservative, moderate, neutral");
  if (!["adjusted", "unadjusted"].includes(s.basis)) throw new ScenarioError("basis must be adjusted or unadjusted");
  if (!(s.population > 0)) throw new ScenarioError("population must be positive");
  if (s.cost_per_user < 0 || s.value_per_outcome < 0) throw new ScenarioError("cost_per_user and value_per_outcome must be non-negative");
  if (!(s.targeting_pct >= 0 && s.targeting_pct <= 100)) throw new ScenarioError("targeting_pct must be between 0 and 100");
  if (s.budget != null && s.budget < 0) throw new ScenarioError("budget must be non-negative");
}

type Econ = { incremental: number[]; incremental_low: number[]; incremental_high: number[]; cost: number[]; profit: number[]; profit_low: number[]; profit_high: number[]; profit_risk: number[]; prob_profit_positive: number[] };

/** Profit along the targeting grid. Quantiles of an increasing affine map are the map of the quantiles. */
function economics(g: number[], cols: Float64Array[], frac: number[], s: ScenarioIn): Econ {
  const N = s.population;
  const slope = s.value_per_outcome * N;
  const q = RISK_Q[s.risk];
  const e: Econ = { incremental: [], incremental_low: [], incremental_high: [], cost: [], profit: [], profit_low: [], profit_high: [], profit_risk: [], prob_profit_positive: [] };
  for (let k = 0; k < frac.length; k++) {
    const cost = s.cost_per_user * N * frac[k];
    const col = cols[k];
    const inc = N * g[k];
    const profit = s.value_per_outcome * inc - cost;
    e.cost.push(cost);
    e.incremental.push(inc);
    e.incremental_low.push(N * quantileSorted(col, 0.025));
    e.incremental_high.push(N * quantileSorted(col, 0.975));
    e.profit.push(profit);
    e.profit_low.push(slope * quantileSorted(col, 0.025) - cost);
    e.profit_high.push(slope * quantileSorted(col, 0.975) - cost);
    e.profit_risk.push(q == null ? profit : slope * quantileSorted(col, q) - cost);
    e.prob_profit_positive.push(slope > 0 ? countAbove(col, cost / slope) / col.length : -cost > 0 ? 1 : 0);
  }
  return e;
}

function row(e: Econ, k: number, frac: number[], s: ScenarioIn) {
  const cost = e.cost[k];
  return {
    targeting_pct: frac[k] * 100,
    targeted_users: s.population * frac[k],
    incremental_outcomes: e.incremental[k],
    incremental_low: e.incremental_low[k],
    incremental_high: e.incremental_high[k],
    treatment_cost: cost,
    incremental_value: s.value_per_outcome * e.incremental[k],
    profit: e.profit[k],
    profit_low: e.profit_low[k],
    profit_high: e.profit_high[k],
    profit_risk_adjusted: e.profit_risk[k],
    roi: cost > 0 ? e.profit[k] / cost : null,
    prob_profit_positive: k > 0 ? e.prob_profit_positive[k] : null,
    cost_per_incremental_outcome: e.incremental[k] > 0 ? cost / e.incremental[k] : null,
  };
}

function maxIndex(frac: number[], s: ScenarioIn): number {
  if (s.budget == null || s.cost_per_user <= 0) return frac.length - 1;
  const cap = Math.min(1, s.budget / (s.cost_per_user * s.population)) + 1e-12;
  let n = 0;
  for (const f of frac) if (f <= cap) n++;
  return n - 1;
}

function argmax(xs: number[], upto: number): number {
  let best = 0;
  for (let i = 1; i <= upto; i++) if (xs[i] > xs[best]) best = i;
  return best;
}

function solve(cs: CurveSet, s: ScenarioIn) {
  const frac = cs.fraction;
  const kMax = maxIndex(frac, s);
  const kReq = pyRound((s.targeting_pct / 100) * (frac.length - 1));
  const kSel = Math.min(kReq, kMax);
  const out: any = { k_max: kMax, k_selected: kSel, capped: kSel < kReq, econ: {}, at_selected: {}, optimum: {}, selected_on: cs.validPoint ? "validation" : "test" };
  for (const m of cs.models) {
    const e = economics(cs.point[m], cs.boot[m], frac, s);
    const chooser = cs.validPoint ? economics(cs.validPoint[m], cs.validBoot![m], frac, s) : e;
    const kOpt = argmax(chooser.profit_risk, kMax);
    out.econ[m] = e;
    out.at_selected[m] = row(e, kSel, frac, s);
    out.optimum[m] = row(e, kOpt, frac, s);
  }
  return out;
}

const cutoff = (cs: CurveSet, strategy: string, k: number) => {
  const t = cs.thresholds?.[strategy];
  return t && k > 0 && k < t.length ? t[k] : null;
};

export async function simulate(scope: string, s: ScenarioIn) {
  validate(s);
  const cs = await loadCurves(scope, s.outcome, s.basis);
  const strategy = s.strategy === "champion" ? cs.champion : s.strategy;
  if (!cs.point[strategy]) throw new ScenarioError(`Unknown strategy '${s.strategy}'`);
  const frac = cs.fraction;
  const sol = solve(cs, s);
  const kSel: number = sol.k_selected;
  const kMax: number = sol.k_max;
  const last = frac.length - 1;
  const name = (m: string) => cs.names[m] ?? m;

  const rows: any[] = [{ id: "none", name: "Treat nobody", kind: "reference", ...row(sol.econ[strategy], 0, frac, s), feasible: true }];
  for (const m of cs.models) {
    rows.push({ id: m, name: name(m), kind: m === "random" || m === "response" ? "baseline" : "uplift_model", ...sol.at_selected[m], feasible: true, optimum: sol.optimum[m], is_champion: m === cs.champion });
  }
  rows.push({ id: "all", name: "Treat everyone", kind: "reference", ...row(sol.econ[strategy], last, frac, s), feasible: kMax === last });

  const o = sol.optimum[strategy];
  const keys = ["targeting_pct", "profit", "profit_risk_adjusted", "profit_low", "profit_high", "incremental_outcomes", "treatment_cost", "targeted_users", "prob_profit_positive", "roi"];
  const kRec = pyRound((o.targeting_pct / 100) * last);
  let best: any;
  if (o.targeting_pct <= 0 || o.profit_risk_adjusted <= 0) {
    best = { id: "none", name: "Treat nobody", action: "hold", ...Object.fromEntries(keys.map((k) => [k, k === "roi" ? null : 0])), prob_profit_positive: null };
  } else if (o.targeting_pct >= 100) {
    best = { id: "all", name: "Treat everyone", action: "roll_out", ...Object.fromEntries(keys.map((k) => [k, o[k]])) };
  } else {
    best = { id: strategy, name: name(strategy), action: "target", ...Object.fromEntries(keys.map((k) => [k, o[k]])) };
  }
  best.criterion = RISK_LABELS[s.risk];
  best.coverage_selected_on = sol.selected_on;
  best.score_cutoff = best.action === "target" ? cutoff(cs, strategy, kRec) : null;
  best.at_budget_limit = s.budget != null && o.targeting_pct >= frac[kMax] * 100 - 1e-9 && kMax < last;

  const targeting_rule = {
    score_kind: cs.scoreKind?.[strategy] ?? null,
    selected_cutoff: cutoff(cs, strategy, kSel),
    recommended_cutoff: best.score_cutoff,
    note: "Score threshold observed on the held-out test split; treat users whose model score is at least this value.",
  };

  const sel = sol.at_selected[strategy];
  const inc = sel.incremental_outcomes;
  const targeted = sel.targeted_users;
  const popEffect = cs.point[strategy][last];
  const threshold = s.value_per_outcome > 0 ? s.cost_per_user / s.value_per_outcome : null;
  const break_even = {
    required_effect_per_targeted_user: threshold,
    average_effect_in_targeted_group: targeted > 0 ? inc / targeted : null,
    population_average_effect: popEffect,
    break_even_value_per_outcome: inc > 0 ? sel.treatment_cost / inc : null,
    break_even_cost_per_user: targeted > 0 ? (s.value_per_outcome * inc) / targeted : null,
    treat_everyone_break_even_value: popEffect > 0 ? s.cost_per_user / popEffect : null,
    treat_everyone_is_profitable: threshold != null && popEffect > threshold,
  };

  const grid = MULTIPLIERS.map((cm) =>
    MULTIPLIERS.map((vm) => {
      const a = solve(cs, { ...s, cost_per_user: s.cost_per_user * cm, value_per_outcome: s.value_per_outcome * vm });
      return {
        profit_at_selected: a.at_selected[strategy].profit,
        targeting_pct_at_selected: a.at_selected[strategy].targeting_pct,
        optimal_targeting_pct: a.optimum[strategy].targeting_pct,
        profit_at_optimum: a.optimum[strategy].profit,
      };
    }),
  );

  const profitWith = (kw: Partial<ScenarioIn>, scale = 1) => {
    const alt = { ...s, ...kw };
    const k = Math.min(kSel, maxIndex(frac, alt));
    return alt.value_per_outcome * alt.population * cs.point[strategy][k] * scale - alt.cost_per_user * alt.population * frac[k];
  };
  const tornado = [
    { driver: "Value per incremental outcome", change: "±25%", profit_unfavourable: profitWith({ value_per_outcome: s.value_per_outcome * 0.75 }), profit_favourable: profitWith({ value_per_outcome: s.value_per_outcome * 1.25 }) },
    { driver: "Treatment cost per user", change: "±25%", profit_unfavourable: profitWith({ cost_per_user: s.cost_per_user * 1.25 }), profit_favourable: profitWith({ cost_per_user: s.cost_per_user * 0.75 }) },
    { driver: "Treatment effect size", change: "±25%", profit_unfavourable: profitWith({}, 0.75), profit_favourable: profitWith({}, 1.25) },
    { driver: "Sampling uncertainty (95% bootstrap interval)", change: "held-out estimate", profit_unfavourable: sel.profit_low, profit_favourable: sel.profit_high },
  ].map((r) => ({ ...r, swing: r.profit_favourable - r.profit_unfavourable }));
  tornado.sort((a, b) => Math.abs(b.swing) - Math.abs(a.swing));

  const step = Math.max(1, Math.floor((frac.length - 1) / 100));
  const idx = frac.map((_, i) => i).filter((i) => i % step === 0);
  const profit_curves = {
    targeting_pct: idx.map((i) => frac[i] * 100),
    max_affordable_pct: frac[kMax] * 100,
    strategies: Object.fromEntries(cs.models.map((m) => [m, {
      name: name(m),
      profit: idx.map((i) => sol.econ[m].profit[i]),
      profit_low: idx.map((i) => sol.econ[m].profit_low[i]),
      profit_high: idx.map((i) => sol.econ[m].profit_high[i]),
      incremental: idx.map((i) => sol.econ[m].incremental[i]),
    }])),
  };

  return {
    meta: cs.meta,
    scenario: { ...s, strategy_resolved: strategy, strategy_name: name(strategy), risk_criterion: RISK_LABELS[s.risk] },
    budget: { budget: s.budget, max_affordable_pct: frac[kMax] * 100, requested_pct: s.targeting_pct, applied_pct: frac[kSel] * 100, capped_by_budget: sol.capped },
    selected: sel,
    selected_optimum: sol.optimum[strategy],
    targeting_rule,
    strategies: rows,
    recommendation: best,
    break_even,
    sensitivity: { multipliers: MULTIPLIERS, grid_rows_cost_cols_value: grid, tornado, base_profit: sel.profit },
    profit_curves,
    caveats: [
      "All monetary figures are scenario estimates: cost and value per outcome are your assumptions, not fields in the dataset.",
      "Incremental outcomes come from the held-out test split and are scaled linearly to the population size you entered.",
      sol.selected_on === "validation"
        ? "The recommended targeting depth is chosen on the validation split and its profit is reported on the separate test split."
        : "The recommended targeting depth is tuned on the same held-out curve it is evaluated on, so its profit is mildly optimistic.",
      "Intervals reflect sampling uncertainty in the test split only, not uncertainty in your cost/value assumptions or in how well this dataset represents your users.",
      "The public dataset was sub-sampled non-uniformly for privacy, so absolute effect sizes are not the advertiser's true incrementality.",
    ],
  };
}
