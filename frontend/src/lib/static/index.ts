/**
 * Static API: serves the same contract as the FastAPI service from the exported files, computing the
 * interactive endpoints in the browser. Used when NEXT_PUBLIC_DATA_MODE=static (the hosted build).
 */
import { buildBrief } from "./brief";
import { loadJson } from "./data";
import { minimumDetectableEffect, plan, DesignError } from "./power";
import { simulateSequential } from "./sequential";
import { ScenarioError, simulate, type ScenarioIn } from "./simulate";

export class StaticApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const SCENARIO_DEFAULTS: ScenarioIn = {
  outcome: "visit", strategy: "champion", population: 1_000_000, cost_per_user: 0.05, value_per_outcome: 5,
  targeting_pct: 20, budget: null, risk: "moderate", basis: "adjusted",
};

async function defaultScope(): Promise<string> {
  return (await loadJson("meta.json")).default_scope;
}

export async function staticApi(path: string, init?: RequestInit): Promise<any> {
  const url = new URL(path, "http://static.local");
  const p = url.pathname;
  const scope = url.searchParams.get("scope") ?? (await defaultScope());
  const outcome = url.searchParams.get("outcome") ?? "visit";
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  const method = (init?.method ?? "GET").toUpperCase();

  try {
    if (method === "GET") {
      if (p === "/meta") return loadJson("meta.json");
      if (p === "/health") return { status: "ok", mode: "static" };
      if (p === "/train/status") return { state: "idle", can_train: false, trainable_scope: "dev_sample", static: true };
      if (["/overview", "/diagnostics", "/data-quality", "/sql", "/insights"].includes(p)) return loadJson(`${scope}${p}.json`);
      if (["/segments", "/models", "/curves", "/explain"].includes(p)) {
        if (!["visit", "conversion"].includes(outcome)) throw new StaticApiError(422, `Unknown outcome '${outcome}'.`);
        return loadJson(`${scope}${p}.${outcome}.json`);
      }
      if (p.startsWith("/sql/")) return loadJson(`${scope}/sql/${p.slice(5)}.json`);
    }
    if (method === "POST") {
      if (p === "/simulate") return simulate(scope, { ...SCENARIO_DEFAULTS, ...body });
      if (p === "/brief") return buildBrief(scope, { ...SCENARIO_DEFAULTS, ...body });
      if (p === "/sequential") return simulateSequential(body.n_looks ?? 10, body.alpha ?? 0.05, body.power ?? 0.8);
      if (p === "/train") throw new StaticApiError(409, "This hosted demo serves cached results. Retraining needs the Python backend: clone the repo and run `make api`.");
      if (p === "/plan") {
        const exp = await loadJson(`${scope}/raw/experiment.json`);
        const o = exp.data.outcomes[body.outcome ?? "visit"];
        if (!o) throw new StaticApiError(422, "Unknown outcome.");
        const base = body.base_rate ?? o.rate_control;
        if (!(body.mde_relative > 0)) throw new StaticApiError(422, "mde_relative must be positive.");
        const out: any = plan(base, body.mde_relative, body.treatment_share ?? 0.5, body.alpha ?? 0.05, body.power ?? 0.8, body.users_per_day ?? null);
        const nObs = o.n_treatment + o.n_control;
        const share = o.n_treatment / nObs;
        const mde = minimumDetectableEffect(nObs, o.rate_control, share, body.alpha ?? 0.05, body.power ?? 0.8);
        out.observed_experiment = { n_total: nObs, treatment_share: share, base_rate: o.rate_control, mde_absolute: mde, mde_relative: mde / o.rate_control, observed_effect: o.absolute_effect };
        return { meta: exp.meta, outcome: body.outcome ?? "visit", base_rate_source: body.base_rate != null ? "user input" : "observed control rate", ...out };
      }
    }
  } catch (e) {
    if (e instanceof ScenarioError || e instanceof DesignError) throw new StaticApiError(422, e.message);
    throw e;
  }
  throw new StaticApiError(404, `No static route for ${method} ${p}`);
}
