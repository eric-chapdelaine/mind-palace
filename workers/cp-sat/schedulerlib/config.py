"""Model constants and the default solver configuration."""

# Reported per solve so a stored `schedule_runs` row says which algorithm produced it.
MODEL_VERSION = "cp-sat-v8"
GREEDY_MODEL_VERSION = "greedy-v1"

# Slot grid / horizon defaults. Overridable per run through the payload `config`.
# The grid is the full day so sleep, wake, and meals can be real scheduled blocks; tasks may
# cross midnight (a sleep block spans two dates).
DEFAULT_CONFIG = {
    "slotMinutes": 30,
    "dayStart": "00:00",
    "dayEnd": "24:00",
    "timeZone": "America/New_York",
    "priorityMode": "weighted",  # "weighted" | "fair"
    "solver": "greedy",         # "greedy" (default) | "cp-sat"
    "timeBudgetSeconds": 15,     # CP-SAT only; the greedy is iteration-bounded and deterministic
    "compact": True,             # CP-SAT post-pass that pulls blocks earlier (preferEarlier)
}
