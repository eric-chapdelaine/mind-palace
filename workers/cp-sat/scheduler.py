"""CP-SAT scheduling worker.

Reads one JSON scheduling problem from stdin and writes one JSON solution to stdout. It never
touches SQLite; the TypeScript control plane remains the only database writer.

The worker is a pure function: `now` and `horizonDays` arrive in the payload, so the same payload
always yields the same schedule. Work is placed as time intervals — a non-splittable task is one
optional interval, a splittable task is `remaining / slot` unit intervals — and a single
`NoOverlap` keeps intervals and fixed commitments apart. Rules are data: `applies` selects tasks
and `effect` shapes eligibility (hard) or the weighted objective (soft). `preferEarlier` is not an
objective term; a greedy compaction pass applies it after the solve.

The implementation lives in the `schedulerlib` package so no single file has to hold the whole
model. This module is the script entry point and re-exports the names the unit tests import.
"""

from schedulerlib import (  # noqa: F401 - re-exported for the tests
    DEFAULT_CONFIG,
    MODEL_VERSION,
    ZoneInfo,
    build_slots,
    condition_matches,
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
