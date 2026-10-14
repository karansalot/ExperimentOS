"""ExperimentOS: experimentation, causal inference and uplift analytics."""
import sys
import warnings

if sys.platform == "darwin":
    # Apple's Accelerate BLAS sets spurious floating-point flags inside matmul on arm64
    # (NumPy 2.0); the results are correct. Our own estimators assert finiteness explicitly.
    warnings.filterwarnings("ignore", message=".*encountered in matmul", category=RuntimeWarning)

__version__ = "0.1.0"
