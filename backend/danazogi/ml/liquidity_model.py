"""Backward-compatible alias for the liquidity model.

The liquidity-need classifier was replaced by a cash-shortfall regression;
the active implementation lives in `cash_model`. This module only re-exports
its public API so older imports keep working.
"""

from .cash_model import VERSION, predict, train

__all__ = ["VERSION", "predict", "train"]
