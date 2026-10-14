"""Bayesian read-out of a two-arm conversion test (Beta-Binomial).

Complements the frequentist tests with the quantities stakeholders actually ask for:
the probability that treatment is better, a credible interval for the lift, and the
expected loss of shipping the wrong variant. Posteriors are sampled with a fixed seed.
"""
from __future__ import annotations

import numpy as np

from .. import config


def beta_binomial(x_t: int, n_t: int, x_c: int, n_c: int, prior: tuple[float, float] = (1.0, 1.0),
                  draws: int = 400_000, seed: int = config.SEED, ci: float = 0.95) -> dict:
    """Posterior summaries under independent Beta(prior) priors on each arm's rate."""
    a, b = prior
    rng = np.random.default_rng(seed)
    p_t = rng.beta(a + x_t, b + n_t - x_t, draws)
    p_c = rng.beta(a + x_c, b + n_c - x_c, draws)
    diff = p_t - p_c
    rel = p_t / p_c - 1
    lo, hi = (1 - ci) / 2, (1 + ci) / 2
    return {
        "prior": {"alpha": a, "beta": b, "description": f"Beta({a:g}, {b:g}) on each arm's rate (uniform when 1, 1)"},
        "draws": draws,
        "posterior_mean_treatment": float(p_t.mean()),
        "posterior_mean_control": float(p_c.mean()),
        "prob_treatment_better": float((diff > 0).mean()),
        "absolute_lift_mean": float(diff.mean()),
        "absolute_lift_ci": [float(np.quantile(diff, lo)), float(np.quantile(diff, hi))],
        "relative_lift_mean": float(rel.mean()),
        "relative_lift_ci": [float(np.quantile(rel, lo)), float(np.quantile(rel, hi))],
        # Expected loss: the rate given up, on average, if we pick a variant and it is actually worse.
        "expected_loss_ship_treatment": float(np.maximum(-diff, 0).mean()),
        "expected_loss_keep_control": float(np.maximum(diff, 0).mean()),
        "prob_relative_lift_above": {f"{t:g}": float((rel > t).mean()) for t in (0.0, 0.05, 0.1, 0.2, 0.3, 0.5)},
        "ci_level": ci,
    }
