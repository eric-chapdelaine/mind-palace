"""CP-SAT scheduling worker internals.

`workers/cp-sat/scheduler.py` is the thin script entry point; the implementation lives here so no
single file has to hold the whole model. Imports are grouped by responsibility:

  * `config`    — model version and default configuration.
  * `timegrid`  — slot-grid construction and time parsing.
  * `weather`   — forecast indexing and the rule-defined weather gate.
  * `rules`     — task/effect evaluation and hard eligibility.
  * `objective` — weighted-objective helpers and the greedy compaction post-pass.
  * `solve`     — model construction, solving, and output shaping.
  * `main`      — stdin/stdout protocol.

The public names below are re-exported so the script and the unit tests can import them from one
place.
"""

from .config import DEFAULT_CONFIG, MODEL_VERSION
from .objective import decision_weights
from .rules import condition_matches, day_matches, rule_strength, window_slot_indices
from .solve import solve
from .timegrid import ZoneInfo, build_slots, parse_datetime
from .weather import weather_is_nice

__all__ = [
    "DEFAULT_CONFIG",
    "MODEL_VERSION",
    "ZoneInfo",
    "build_slots",
    "condition_matches",
    "day_matches",
    "decision_weights",
    "parse_datetime",
    "rule_strength",
    "solve",
    "weather_is_nice",
    "window_slot_indices",
]
