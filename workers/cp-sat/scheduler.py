"""Scheduling worker.

Reads one JSON scheduling problem from stdin and writes one JSON solution to stdout. It never
touches SQLite; the TypeScript control plane remains the only database writer.

The worker is a pure function: `now` and `horizonDays` arrive in the payload, so the same payload
always yields the same schedule. Rules are data: `applies` selects tasks and `effect` shapes
eligibility (hard) or the weighted objective (soft).

Two solvers implement the same protocol and are selected with `config.solver`:

  * `greedy` (default) — priority-ordered construction plus relocate/insert/swap/eject local
    search, iteration-bounded and deterministic. It models a splittable task as k independent
    units, so partial progress is allowed.
  * `cp-sat` — optional intervals with one `NoOverlap`; a splittable task is all-or-nothing.

Both emit the same assignment/score shape, so the control plane does not care which one ran. The
solvers live in `schedulerlib/greedy.py` and `schedulerlib/cp_sat.py`; `schedulerlib/solve.py`
prepares the problem, dispatches, and shapes the output. This module is the script entry point and
re-exports the names the unit tests import.
"""

from schedulerlib import (  # noqa: F401 - re-exported for the tests
    DEFAULT_CONFIG,
    GREEDY_MODEL_VERSION,
    MODEL_VERSION,
    cp_sat,
    greedy,
    ZoneInfo,
    build_slots,
    condition_matches,
    day_matches,
    decision_weights,
    parse_datetime,
    rule_strength,
    solve,
    weather_is_nice,
    window_slot_indices,
)
from schedulerlib.main import main


if __name__ == "__main__":
    main()
