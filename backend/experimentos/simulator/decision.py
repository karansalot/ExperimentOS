"""Business decision simulator.

Turns held-out uplift curves into scenario economics. The dataset contains no
revenue or cost fields, so every monetary figure is a *scenario estimate*
driven by user-supplied assumptions; only the incremental-outcome curves are
estimated from data.
"""
from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from typing import Optional

import numpy as np

from .. import artifacts, config

RISK_QUANTILES = {"conservative": 0.10, "moderate": 0.25, "neutral": None}
RISK_LABELS = {
    "conservative": "10th percentile of bootstrap profit",
    "moderate": "25th percentile of bootstrap profit",
    "neutral": "expected profit",
}
BASES = ("adjusted", "unadjusted")
MULTIPLIERS = (0.5, 0.75, 1.0, 1.25, 1.5, 2.0)


@dataclass
class Scenario:
    outcome: str = "visit"
    strategy: str = "champion"
    population: int = 1_000_000
    cost_per_user: float = 0.05
    value_per_outcome: float = 5.0
    targeting_pct: float = 20.0
    budget: Optional[float] = None
    risk: str = "moderate"
    basis: str = "adjusted"

    def validate(self) -> None:
        if self.outcome not in config.OUTCOMES:
            raise ValueError(f"outcome must be one of {config.OUTCOMES}")
        if self.risk not in RISK_QUANTILES:
            raise ValueError(f"risk must be one of {sorted(RISK_QUANTILES)}")
        if self.basis not in BASES:
            raise ValueError(f"basis must be one of {BASES}")
        if self.population <= 0:
            raise ValueError("population must be positive")
        if self.cost_per_user < 0 or self.value_per_outcome < 0:
            raise ValueError("cost_per_user and value_per_outcome must be non-negative")
        if not 0 <= self.targeting_pct <= 100:
            raise ValueError("targeting_pct must be between 0 and 100")
        if self.budget is not None and self.budget < 0:
            raise ValueError("budget must be non-negative")


@dataclass
class CurveSet:
    """Point and bootstrap gain curves (incremental outcomes per user) for one outcome and basis."""

    fraction: np.ndarray  # (G,)
    point: dict  # model -> (G,)
    boot: dict  # model -> (B, G)
    names: dict  # model -> display name
    champion: str
    meta: dict
    # Validation-split curves: targeting depth is chosen here, profit is reported on the test curves above.
    valid_point: Optional[dict] = None
    valid_boot: Optional[dict] = None
    thresholds: Optional[dict] = None  # model -> score of the last user included at each depth
    score_kind: Optional[dict] = None


@lru_cache(maxsize=16)
def _load(scope_name: str, outcome: str, basis: str, mtime: float) -> CurveSet:
    curves = artifacts.read(scope_name, "curves")
    models = artifacts.read(scope_name, "models")
    c = curves["data"]["outcomes"][outcome]
    npz = np.load(config.SCOPES[scope_name].artifacts / f"bootstrap_{outcome}.npz")
    mo = models["data"]["outcomes"][outcome]
    valid_point = valid_boot = None
    valid_path = config.SCOPES[scope_name].artifacts / f"bootstrap_valid_{outcome}.npz"
    if "validation" in c and valid_path.exists():
        vz = np.load(valid_path)
        valid_point = {m: np.asarray(v[basis], dtype=float) for m, v in c["validation"]["models"].items()}
        valid_boot = {m: vz[f"{m}__{basis}"].astype(float) for m in c["models"]}
    return CurveSet(
        valid_point=valid_point, valid_boot=valid_boot,
        thresholds=c.get("score_thresholds"), score_kind=c.get("score_kind"),
        fraction=np.asarray(c["fraction"], dtype=float),
        point={m: np.asarray(v[basis]["value"], dtype=float) for m, v in c["models"].items()},
        boot={m: npz[f"{m}__{basis}"].astype(float) for m in c["models"]},
        names={m["id"]: m["name"] for m in mo["models"]},
        champion=mo["champion"],
        meta={**curves["meta"], "evaluation_rows": c["n_rows"], "n_boot": c["n_boot"], "evaluation_split": c["split"]},
    )


def load_curves(scope_name: str, outcome: str, basis: str) -> CurveSet:
    p = artifacts.path(scope_name, "curves")
    if not p.exists():
        raise FileNotFoundError(f"No uplift curves for scope {scope_name!r}. Train models first.")
    return _load(scope_name, outcome, basis, p.stat().st_mtime)


def _risk_value(samples: np.ndarray, point: np.ndarray, risk: str) -> np.ndarray:
    q = RISK_QUANTILES[risk]
    return point if q is None else np.quantile(samples, q, axis=0)


def _economics(gain_point: np.ndarray, gain_boot: np.ndarray, frac: np.ndarray, s: Scenario) -> dict:
    """Profit along the whole targeting grid for one strategy."""
    cost = s.cost_per_user * s.population * frac
    inc = s.population * gain_point
    inc_boot = s.population * gain_boot
    profit = s.value_per_outcome * inc - cost
    profit_boot = s.value_per_outcome * inc_boot - cost
    return {
        "incremental": inc, "incremental_low": np.percentile(inc_boot, 2.5, axis=0), "incremental_high": np.percentile(inc_boot, 97.5, axis=0),
        "cost": cost, "profit": profit,
        "profit_low": np.percentile(profit_boot, 2.5, axis=0), "profit_high": np.percentile(profit_boot, 97.5, axis=0),
        "profit_risk": _risk_value(profit_boot, profit, s.risk),
        "prob_profit_positive": (profit_boot > 0).mean(axis=0),
    }


def _row(e: dict, k: int, frac: np.ndarray, s: Scenario) -> dict:
    targeted = s.population * frac[k]
    cost = float(e["cost"][k])
    return {
        "targeting_pct": float(frac[k] * 100),
        "targeted_users": float(targeted),
        "incremental_outcomes": float(e["incremental"][k]),
        "incremental_low": float(e["incremental_low"][k]),
        "incremental_high": float(e["incremental_high"][k]),
        "treatment_cost": cost,
        "incremental_value": float(s.value_per_outcome * e["incremental"][k]),
        "profit": float(e["profit"][k]),
        "profit_low": float(e["profit_low"][k]),
        "profit_high": float(e["profit_high"][k]),
        "profit_risk_adjusted": float(e["profit_risk"][k]),
        "roi": float(e["profit"][k] / cost) if cost > 0 else None,
        "prob_profit_positive": float(e["prob_profit_positive"][k]) if k > 0 else None,
        "cost_per_incremental_outcome": float(cost / e["incremental"][k]) if e["incremental"][k] > 0 else None,
    }


def _max_index(frac: np.ndarray, s: Scenario) -> int:
    """Largest grid index affordable under the budget."""
    if s.budget is None or s.cost_per_user <= 0:
        return len(frac) - 1
    cap = s.budget / (s.cost_per_user * s.population)
    return int(np.searchsorted(frac, min(1.0, cap) + 1e-12, side="right") - 1)


def _cutoff(cs: CurveSet, strategy: str, k: int) -> Optional[float]:
    t = (cs.thresholds or {}).get(strategy)
    return t[k] if t and 0 < k < len(t) else None


def _solve(cs: CurveSet, s: Scenario) -> dict:
    frac = cs.fraction
    k_max = _max_index(frac, s)
    k_req = int(round(s.targeting_pct / 100 * (len(frac) - 1)))
    k_sel = min(k_req, k_max)
    out = {"k_max": k_max, "k_selected": k_sel, "capped": k_sel < k_req, "econ": {}, "at_selected": {}, "optimum": {}}
    out["selected_on"] = "validation" if cs.valid_point else "test"
    for m in cs.point:
        e = _economics(cs.point[m], cs.boot[m], frac, s)
        # Choose the depth on the validation split when available, so the test profit reported for it is honest.
        chooser = _economics(cs.valid_point[m], cs.valid_boot[m], frac, s) if cs.valid_point else e
        k_opt = int(np.argmax(chooser["profit_risk"][: k_max + 1]))
        out["econ"][m] = e
        out["at_selected"][m] = _row(e, k_sel, frac, s)
        out["optimum"][m] = _row(e, k_opt, frac, s)
    return out


def simulate(scope_name: str, scenario: Scenario) -> dict:
    """Evaluate a scenario. Pure function of cached curves + assumptions; safe to call per request."""
    s = scenario
    s.validate()
    cs = load_curves(scope_name, s.outcome, s.basis)
    strategy = cs.champion if s.strategy == "champion" else s.strategy
    if strategy not in cs.point:
        raise ValueError(f"Unknown strategy {s.strategy!r}; choose from {sorted(cs.point)} or 'champion'")
    frac = cs.fraction
    sol = _solve(cs, s)
    k_sel, k_max = sol["k_selected"], sol["k_max"]
    last = len(frac) - 1

    # Strategy comparison table --------------------------------------------------
    rows = [{"id": "none", "name": "Treat nobody", "kind": "reference", **_row(sol["econ"][strategy], 0, frac, s), "feasible": True}]
    for m in cs.point:
        r = {"id": m, "name": cs.names.get(m, m), "kind": "baseline" if m in ("random", "response") else "uplift_model",
             **sol["at_selected"][m], "feasible": True, "optimum": sol["optimum"][m], "is_champion": m == cs.champion}
        rows.append(r)
    rows.append({"id": "all", "name": "Treat everyone", "kind": "reference", **_row(sol["econ"][strategy], last, frac, s),
                 "feasible": k_max == last})

    # Recommendation ---------------------------------------------------------------
    # Only the selected strategy is optimised (by default the champion, which was chosen on the
    # validation split), and its depth is chosen on validation too. Test data only measures the result.
    o = sol["optimum"][strategy]
    keys = ("targeting_pct", "profit", "profit_risk_adjusted", "profit_low", "profit_high", "incremental_outcomes",
            "treatment_cost", "targeted_users", "prob_profit_positive", "roi")
    k_rec = int(round(o["targeting_pct"] / 100 * last))
    if o["targeting_pct"] <= 0 or o["profit_risk_adjusted"] <= 0:
        best = {"id": "none", "name": "Treat nobody", "action": "hold", **{k: (0.0 if k != "roi" else None) for k in keys},
                "prob_profit_positive": None}
    elif o["targeting_pct"] >= 100:
        best = {"id": "all", "name": "Treat everyone", "action": "roll_out", **{k: o[k] for k in keys}}
    else:
        best = {"id": strategy, "name": cs.names.get(strategy, strategy), "action": "target", **{k: o[k] for k in keys}}
    best["criterion"] = RISK_LABELS[s.risk]
    best["coverage_selected_on"] = sol["selected_on"]
    best["score_cutoff"] = _cutoff(cs, strategy, k_rec) if best["action"] == "target" else None
    best["at_budget_limit"] = bool(s.budget is not None and o["targeting_pct"] >= frac[k_max] * 100 - 1e-9 and k_max < last)

    targeting_rule = {
        "score_kind": (cs.score_kind or {}).get(strategy),
        "selected_cutoff": _cutoff(cs, strategy, k_sel),
        "recommended_cutoff": best["score_cutoff"],
        "note": "Score threshold observed on the held-out test split; treat users whose model score is at least this value.",
    }

    # Break-even -------------------------------------------------------------------
    sel = sol["at_selected"][strategy]
    inc, targeted = sel["incremental_outcomes"], sel["targeted_users"]
    avg_effect_targeted = inc / targeted if targeted > 0 else None
    pop_effect = float(cs.point[strategy][-1])
    threshold = s.cost_per_user / s.value_per_outcome if s.value_per_outcome > 0 else None
    break_even = {
        "required_effect_per_targeted_user": threshold,
        "average_effect_in_targeted_group": avg_effect_targeted,
        "population_average_effect": pop_effect,
        "break_even_value_per_outcome": (sel["treatment_cost"] / inc) if inc > 0 else None,
        "break_even_cost_per_user": (s.value_per_outcome * inc / targeted) if targeted > 0 else None,
        "treat_everyone_break_even_value": (s.cost_per_user / pop_effect) if pop_effect > 0 else None,
        "treat_everyone_is_profitable": (threshold is not None and pop_effect > threshold),
    }

    # Sensitivity ------------------------------------------------------------------
    grid = []
    for cm in MULTIPLIERS:
        row = []
        for vm in MULTIPLIERS:
            alt = Scenario(**{**s.__dict__, "cost_per_user": s.cost_per_user * cm, "value_per_outcome": s.value_per_outcome * vm})
            # The budget stays fixed in currency terms: a higher cost means fewer users are affordable.
            a = _solve(cs, alt)
            row.append({
                "profit_at_selected": a["at_selected"][strategy]["profit"],
                "targeting_pct_at_selected": a["at_selected"][strategy]["targeting_pct"],
                "optimal_targeting_pct": a["optimum"][strategy]["targeting_pct"],
                "profit_at_optimum": a["optimum"][strategy]["profit"],
            })
        grid.append(row)

    def profit_with(**kw) -> float:
        scale = kw.pop("effect_scale", 1.0)
        alt = Scenario(**{**s.__dict__, **kw})
        k = min(k_sel, _max_index(frac, alt))
        return float(alt.value_per_outcome * alt.population * cs.point[strategy][k] * scale - alt.cost_per_user * alt.population * frac[k])

    base_profit = sel["profit"]
    tornado = []
    for label, lo_kw, hi_kw in [
        ("Value per incremental outcome", {"value_per_outcome": s.value_per_outcome * 0.75}, {"value_per_outcome": s.value_per_outcome * 1.25}),
        ("Treatment cost per user", {"cost_per_user": s.cost_per_user * 1.25}, {"cost_per_user": s.cost_per_user * 0.75}),
        ("Treatment effect size", {"effect_scale": 0.75}, {"effect_scale": 1.25}),
    ]:
        lo, hi = profit_with(**lo_kw), profit_with(**hi_kw)
        tornado.append({"driver": label, "change": "±25%", "profit_unfavourable": lo, "profit_favourable": hi, "swing": hi - lo})
    tornado.append({"driver": "Sampling uncertainty (95% bootstrap interval)", "change": "held-out estimate",
                    "profit_unfavourable": sel["profit_low"], "profit_favourable": sel["profit_high"],
                    "swing": sel["profit_high"] - sel["profit_low"]})
    tornado.sort(key=lambda r: -abs(r["swing"]))

    step = max(1, (len(frac) - 1) // 100)
    idx = list(range(0, len(frac), step))
    profit_curves = {
        "targeting_pct": [float(frac[i] * 100) for i in idx],
        "max_affordable_pct": float(frac[k_max] * 100),
        "strategies": {
            m: {
                "name": cs.names.get(m, m),
                "profit": [float(sol["econ"][m]["profit"][i]) for i in idx],
                "profit_low": [float(sol["econ"][m]["profit_low"][i]) for i in idx],
                "profit_high": [float(sol["econ"][m]["profit_high"][i]) for i in idx],
                "incremental": [float(sol["econ"][m]["incremental"][i]) for i in idx],
            }
            for m in cs.point
        },
    }

    return {
        "meta": cs.meta,
        "scenario": {**s.__dict__, "strategy_resolved": strategy, "strategy_name": cs.names.get(strategy, strategy),
                     "risk_criterion": RISK_LABELS[s.risk]},
        "budget": {
            "budget": s.budget, "max_affordable_pct": float(frac[k_max] * 100), "requested_pct": s.targeting_pct,
            "applied_pct": float(frac[k_sel] * 100), "capped_by_budget": sol["capped"],
        },
        "selected": sel,
        "selected_optimum": sol["optimum"][strategy],
        "targeting_rule": targeting_rule,
        "strategies": rows,
        "recommendation": best,
        "break_even": break_even,
        "sensitivity": {"multipliers": list(MULTIPLIERS), "grid_rows_cost_cols_value": grid, "tornado": tornado, "base_profit": base_profit},
        "profit_curves": profit_curves,
        "caveats": [
            "All monetary figures are scenario estimates: cost and value per outcome are your assumptions, not fields in the dataset.",
            "Incremental outcomes come from the held-out test split and are scaled linearly to the population size you entered.",
            ("The recommended targeting depth is chosen on the validation split and its profit is reported on the separate test split."
             if sol["selected_on"] == "validation" else
             "The recommended targeting depth is tuned on the same held-out curve it is evaluated on, so its profit is mildly optimistic."),
            "Intervals reflect sampling uncertainty in the test split only, not uncertainty in your cost/value assumptions or in how well this dataset represents your users.",
            "The public dataset was sub-sampled non-uniformly for privacy, so absolute effect sizes are not the advertiser's true incrementality.",
        ],
    }
