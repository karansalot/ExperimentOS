"""Uplift model definitions.

Every model exposes ``fit(X, t, y)`` and ``score(X)`` (higher = target first).
Models that estimate an individual treatment effect also expose
``predict_uplift(X)``; pure ranking baselines return ``None`` there.
"""
from __future__ import annotations

from typing import Optional

import numpy as np

from .. import config
from ..learners import HGB_PARAMS, LOGIT_PARAMS, gradient_boosting, logistic


class UpliftModel:
    id: str = ""
    name: str = ""
    family: str = ""
    description: str = ""
    params: dict = {}
    estimates_uplift: bool = True

    def __init__(self, seed: int = config.SEED):
        self.seed = seed

    def fit(self, X: np.ndarray, t: np.ndarray, y: np.ndarray) -> UpliftModel:
        raise NotImplementedError

    def predict_uplift(self, X: np.ndarray) -> Optional[np.ndarray]:
        raise NotImplementedError

    def score(self, X: np.ndarray) -> np.ndarray:
        return self.predict_uplift(X)

    def component_predictions(self, X: np.ndarray) -> dict:
        """Outcome-model predictions keyed by the arm they describe ('treatment' / 'control')."""
        return {}


class _TwoModel(UpliftModel):
    """Separate outcome models per arm; uplift = mu_1(x) - mu_0(x)."""

    def _make(self):
        raise NotImplementedError

    def fit(self, X, t, y):
        self.mu1 = self._make().fit(X[t == 1], y[t == 1])
        self.mu0 = self._make().fit(X[t == 0], y[t == 0])
        return self

    def component_predictions(self, X):
        return {"treatment": self.mu1.predict_proba(X)[:, 1], "control": self.mu0.predict_proba(X)[:, 1]}

    def predict_uplift(self, X):
        c = self.component_predictions(X)
        return c["treatment"] - c["control"]


class TwoModelLogit(_TwoModel):
    id = "two_model_logit"
    name = "Two-model (logistic)"
    family = "Two-model / T-learner"
    description = (
        "Two independent logistic regressions on standardised features, one per arm; "
        "uplift is the difference of predicted probabilities. A linear, transparent baseline."
    )
    params = {"base_learner": "StandardScaler + LogisticRegression", **LOGIT_PARAMS}

    def _make(self):
        return logistic(self.seed)


class TLearnerGBM(_TwoModel):
    id = "t_learner_gbm"
    name = "T-learner (gradient boosting)"
    family = "Two-model / T-learner"
    description = (
        "Same two-model construction with gradient-boosted trees as the base learner, "
        "so non-linearities and interactions are captured within each arm."
    )
    params = {"base_learner": "HistGradientBoostingClassifier", **HGB_PARAMS}

    def _make(self):
        return gradient_boosting(self.seed)


class SLearnerGBM(UpliftModel):
    id = "s_learner_gbm"
    name = "S-learner (gradient boosting)"
    family = "S-learner"
    description = (
        "One gradient-boosted model on features plus the treatment indicator; "
        "uplift is the prediction with treatment=1 minus the prediction with treatment=0."
    )
    params = {"base_learner": "HistGradientBoostingClassifier", "treatment_as_feature": True, **HGB_PARAMS}

    @staticmethod
    def _with_t(X, value):
        return np.column_stack([X, np.full(len(X), value, dtype=X.dtype)])

    def fit(self, X, t, y):
        self.model = gradient_boosting(self.seed).fit(np.column_stack([X, t.astype(X.dtype)]), y)
        return self

    def component_predictions(self, X):
        return {
            "treatment": self.model.predict_proba(self._with_t(X, 1))[:, 1],
            "control": self.model.predict_proba(self._with_t(X, 0))[:, 1],
        }

    def predict_uplift(self, X):
        c = self.component_predictions(X)
        return c["treatment"] - c["control"]


class ResponseModel(UpliftModel):
    """Response-propensity baseline: rank by P(outcome | treated, x). Not an uplift estimate."""

    id = "response"
    name = "Response propensity"
    family = "Baseline"
    description = (
        "Targets the users most likely to produce the outcome when treated. It ignores what they would "
        "have done anyway, which is exactly the gap uplift models aim to close."
    )
    params = {"base_learner": "HistGradientBoostingClassifier", "trained_on": "treatment arm only", **HGB_PARAMS}
    estimates_uplift = False

    def __init__(self, seed: int = config.SEED, fitted=None):
        super().__init__(seed)
        self.model = fitted

    def fit(self, X, t, y):
        if self.model is None:
            self.model = gradient_boosting(self.seed).fit(X[t == 1], y[t == 1])
        return self

    def predict_uplift(self, X):
        return None

    def score(self, X):
        return self.model.predict_proba(X)[:, 1]

    def component_predictions(self, X):
        return {"treatment": self.score(X)}


RANDOM_BASELINE = {
    "id": "random",
    "name": "Random targeting",
    "family": "Baseline",
    "description": "Treat a uniformly random fraction of users. Its expected gain is the population-average effect times the fraction treated.",
    "estimates_uplift": False,
    "params": {},
}
