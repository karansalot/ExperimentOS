"""Shared base learners, so every module uses identical, seeded estimators."""
from __future__ import annotations

from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from . import config

HGB_PARAMS = {
    "max_iter": 200,
    "learning_rate": 0.1,
    "max_leaf_nodes": 31,
    "min_samples_leaf": 200,
    "l2_regularization": 1.0,
    "early_stopping": True,
    "validation_fraction": 0.1,
    "n_iter_no_change": 10,
}
LOGIT_PARAMS = {"C": 1.0, "max_iter": 300, "solver": "lbfgs"}


def gradient_boosting(seed: int = config.SEED, **overrides) -> HistGradientBoostingClassifier:
    return HistGradientBoostingClassifier(**{**HGB_PARAMS, **overrides}, random_state=seed)


def logistic(seed: int = config.SEED, **overrides):
    return make_pipeline(StandardScaler(), LogisticRegression(**{**LOGIT_PARAMS, **overrides}, random_state=seed))
