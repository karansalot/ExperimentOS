/**
 * Parity: the in-browser TypeScript port must reproduce the Python simulator, brief and planner.
 * Fixtures are written by `python -m experimentos.export_static`; data files are read from public/data.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import fixture from "./parity.fixture.json";

const DATA = join(__dirname, "../../../public/data");

beforeAll(() => {
  vi.stubGlobal("fetch", async (url: string) => {
    const file = join(DATA, url.replace(/^.*\/data\//, ""));
    const buf = readFileSync(file);
    return {
      ok: true,
      status: 200,
      json: async () => JSON.parse(buf.toString("utf8")),
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    };
  });
});

const DEFAULTS = { outcome: "visit", strategy: "champion", population: 1_000_000, cost_per_user: 0.05, value_per_outcome: 5, targeting_pct: 20, budget: null, risk: "moderate", basis: "adjusted" };
const close = (a: number | null, b: number | null, rel = 1e-6, abs = 1e-6) => {
  if (a == null || b == null) return expect(a).toBe(b);
  expect(Math.abs(a - b)).toBeLessThanOrEqual(Math.max(abs, rel * Math.abs(b)));
};

describe("simulator parity with Python", () => {
  for (const [i, ref] of (fixture as any).simulate.entries()) {
    it(`scenario ${i}: ${JSON.stringify(ref.scenario)}`, async () => {
      const { simulate } = await import("./simulate");
      const r: any = await simulate(fixture.scope, { ...DEFAULTS, ...ref.scenario });
      for (const k of ["targeting_pct", "incremental_outcomes", "treatment_cost", "profit", "profit_low", "profit_high", "profit_risk_adjusted", "prob_profit_positive"]) {
        close(r.selected[k], ref.selected[k]);
      }
      expect(r.recommendation.action).toBe(ref.recommendation.action);
      for (const k of ["targeting_pct", "profit", "profit_low", "profit_high", "score_cutoff"]) close(r.recommendation[k], ref.recommendation[k]);
      for (const k of Object.keys(ref.break_even)) {
        const v = ref.break_even[k];
        if (typeof v === "boolean") expect(r.break_even[k]).toBe(v);
        else close(r.break_even[k], v);
      }
      expect(r.budget.capped_by_budget).toBe(ref.budget.capped_by_budget);
      close(r.targeting_rule.selected_cutoff, ref.targeting_rule.selected_cutoff);
      r.strategies.forEach((s: any, j: number) => {
        expect(s.id).toBe(ref.strategies[j].id);
        close(s.profit, ref.strategies[j].profit);
        expect(s.feasible).toBe(ref.strategies[j].feasible);
      });
      close(r.sensitivity.grid_rows_cost_cols_value[0][5].profit_at_optimum, ref.sensitivity_corner.profit_at_optimum);
      expect(r.sensitivity.tornado.map((t: any) => t.driver)).toEqual(ref.tornado.map((t: any) => t.driver));
    });
  }
});

describe("brief parity with Python", () => {
  for (const [i, ref] of (fixture as any).brief.entries()) {
    it(`brief ${i}`, async () => {
      const { buildBrief } = await import("./brief");
      const b: any = await buildBrief(fixture.scope, { ...DEFAULTS, ...ref.scenario });
      expect(b.decision).toBe(ref.decision);
      expect(b.action).toBe(ref.action);
      expect(b.sections.map((s: any) => s.bullets.length)).toEqual(ref.bullet_counts);
      for (const k of Object.keys(ref.key_numbers)) close(b.key_numbers[k], ref.key_numbers[k]);
      expect(b.markdown).toContain("# ExperimentOS decision brief");
    });
  }
});

describe("planner parity with Python", () => {
  it("matches sample sizes and MDE", async () => {
    const { plan, minimumDetectableEffect } = await import("./power");
    for (const ref of (fixture as any).plan) {
      const [base, rel, share, alpha, pw] = ref.args;
      const p = plan(base, rel, share, alpha, pw, 10_000);
      expect(p.required.n_total).toBe(ref.required.n_total);
      expect(p.required.n_treatment).toBe(ref.required.n_treatment);
      close(p.required.achieved_power, ref.required.achieved_power, 1e-9);
      close(p.allocation_cost, ref.allocation_cost, 1e-9);
      expect(p.days_required).toBe(ref.days_required);
      close(minimumDetectableEffect(p.required.n_total, base, share, alpha, pw), ref.mde, 1e-7);
    }
  });
});

describe("numerics", () => {
  it("normal CDF and quantile agree with known values", async () => {
    const { normCdf, normPpf, pyRound } = await import("./math");
    expect(normCdf(1.959963984540054)).toBeCloseTo(0.975, 12);
    expect(normPpf(0.975)).toBeCloseTo(1.959963984540054, 10);
    expect(normPpf(0.8)).toBeCloseTo(0.8416212335729143, 10);
    expect([pyRound(12.5), pyRound(13.5), pyRound(14.2)]).toEqual([12, 14, 14]);
  });

  it("sequential simulation reproduces textbook boundaries", async () => {
    const { simulateSequential } = await import("./sequential");
    const r = simulateSequential(10, 0.05, 0.8, 40_000);
    const d = Object.fromEntries(r.designs.map((x) => [x.id, x]));
    expect(d.pocock.boundary_z[0]).toBeCloseTo(2.555, 1);
    expect(Math.abs(d.obrien_fleming.boundary_z[9] - 2.087)).toBeLessThan(0.04);
    expect(Math.abs(d.naive.false_positive_rate - 0.193)).toBeLessThan(0.015);
    expect(Math.abs(d.obrien_fleming.false_positive_rate - 0.05)).toBeLessThan(0.007);
  });
});
