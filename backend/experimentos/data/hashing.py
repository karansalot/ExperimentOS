"""Deterministic, library-version-independent row hashing.

Splits and samples are derived from a salted splitmix64 hash of ``row_id`` (the
0-based position of the row in the raw file). This is fully specified here, so
the same row always lands in the same split regardless of NumPy / DuckDB
versions, and no row can be in two splits.
"""
from __future__ import annotations

import numpy as np

_MASK = np.uint64(0xFFFFFFFFFFFFFFFF)


def splitmix64(x: np.ndarray) -> np.ndarray:
    """Vectorised splitmix64 finaliser on uint64 input."""
    with np.errstate(over="ignore"):
        z = (x.astype(np.uint64) + np.uint64(0x9E3779B97F4A7C15)) & _MASK
        z = ((z ^ (z >> np.uint64(30))) * np.uint64(0xBF58476D1CE4E5B9)) & _MASK
        z = ((z ^ (z >> np.uint64(27))) * np.uint64(0x94D049BB133111EB)) & _MASK
        return z ^ (z >> np.uint64(31))


def bucket(row_id: np.ndarray, salt: int, n_buckets: int = 100) -> np.ndarray:
    """Map row ids to buckets ``0..n_buckets-1`` using a salted hash."""
    with np.errstate(over="ignore"):
        salted = row_id.astype(np.uint64) ^ splitmix64(np.array([salt], dtype=np.uint64))[0]
    return (splitmix64(salted) % np.uint64(n_buckets)).astype(np.uint8)
