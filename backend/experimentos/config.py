"""Central configuration: paths, dataset identity, column roles, seeds.

Everything that defines *which data* and *which randomness* produced a result
lives here, so that an artifact can be traced back to an exact dataset revision
and seed.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(os.environ.get("EXPERIMENTOS_ROOT", Path(__file__).resolve().parents[2]))
DATA_DIR = Path(os.environ.get("EXPERIMENTOS_DATA_DIR", ROOT / "data"))
RAW_DIR = DATA_DIR / "raw"
PROCESSED_DIR = DATA_DIR / "processed"
ARTIFACTS_DIR = Path(os.environ.get("EXPERIMENTOS_ARTIFACTS_DIR", ROOT / "artifacts"))
SQL_DIR = Path(__file__).resolve().parent / "sql"

# --------------------------------------------------------------------------
# Dataset identity (verified 2026-10-12 against the Hugging Face repository)
# --------------------------------------------------------------------------
HF_REPO = "criteo/criteo-uplift"
HF_REVISION = "2424920019e49d52d72c13ac1143ec5d53af276b"
RAW_FILENAME = "criteo-research-uplift-v2.1.csv.gz"

DATASET = {
    "name": "Criteo Uplift Prediction Dataset",
    "version": "v2.1",
    "publisher": "Criteo AI Lab",
    "source_url": f"https://huggingface.co/datasets/{HF_REPO}/resolve/{HF_REVISION}/{RAW_FILENAME}",
    "landing_page": f"https://huggingface.co/datasets/{HF_REPO}",
    "hf_revision": HF_REVISION,
    "raw_filename": RAW_FILENAME,
    "raw_sha256": "2716e1bf0fd157a93b5bf86924d9088419dfbac2022c6cd90030220634f616dc",
    "raw_bytes": 311_422_618,
    "expected_rows": 13_979_592,
    "license": "CC BY-NC-SA 4.0",
    "license_url": "https://creativecommons.org/licenses/by-nc-sa/4.0/",
    "citation": (
        "Diemert, E., Betlei, A., Renaudin, C., & Amini, M.-R. (2018). "
        "A Large Scale Benchmark for Uplift Modeling. AdKDD & TargetAd Workshop, KDD 2018."
    ),
}

# --------------------------------------------------------------------------
# Column roles
# --------------------------------------------------------------------------
FEATURES = [f"f{i}" for i in range(12)]
TREATMENT = "treatment"
OUTCOMES = ["visit", "conversion"]
EXPOSURE = "exposure"
BINARY_COLUMNS = [TREATMENT, "conversion", "visit", EXPOSURE]
RAW_COLUMNS = FEATURES + BINARY_COLUMNS

# The dataset card states the treatment ratio is 0.85. That is the *design*
# ratio used by the sample-ratio-mismatch check.
DESIGN_TREATMENT_RATIO = 0.85

# --------------------------------------------------------------------------
# Reproducibility
# --------------------------------------------------------------------------
SEED = 20240612
SPLIT_SALT = 0x5EED_0001  # salt for the train/valid/test hash
SAMPLE_SALT = 0x5EED_0002  # salt for the dev-sample hash
# Buckets are 0..99 from a salted splitmix64 hash of row_id.
TRAIN_BUCKETS = (0, 60)  # [0, 60)  -> 60 %
VALID_BUCKETS = (60, 80)  # [60, 80) -> 20 %
TEST_BUCKETS = (80, 100)  # [80, 100) -> 20 %
DEV_SAMPLE_BUCKETS = 5  # sample_bucket < 5 -> ~5 % development sample

ALPHA = 0.05
PROPENSITY_CLIP = (0.05, 0.95)
CODE_VERSION = "0.1.0"


@dataclass(frozen=True)
class Scope:
    """A data scope. Every artifact is stamped with the scope that produced it."""

    name: str
    label: str
    is_sample: bool

    @property
    def parquet(self) -> Path:
        return PROCESSED_DIR / f"criteo_uplift_v2_1.{self.name}.parquet"

    @property
    def artifacts(self) -> Path:
        return ARTIFACTS_DIR / self.name

    @property
    def predictions(self) -> Path:
        return PROCESSED_DIR / f"predictions.{self.name}.parquet"

    @property
    def nuisances(self) -> Path:
        """Cross-fitted propensity / outcome predictions used for doubly-robust scores."""
        return PROCESSED_DIR / f"nuisances.{self.name}.parquet"


SCOPES = {
    "full": Scope("full", "Full dataset", False),
    "dev_sample": Scope("dev_sample", "Development sample (~5%)", True),
}


def get_scope(name: str) -> Scope:
    if name not in SCOPES:
        raise KeyError(f"Unknown scope {name!r}; expected one of {sorted(SCOPES)}")
    return SCOPES[name]
