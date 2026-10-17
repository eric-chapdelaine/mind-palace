"""Model constants and the default solver configuration."""

MODEL_VERSION = "cp-sat-v8"

# Slot grid / horizon defaults. Overridable per run through the payload `config`.
# The grid is the full day so sleep, wake, and meals can be real scheduled blocks; tasks may
# cross midnight (a sleep block spans two dates).
DEFAULT_CONFIG = {
    "slotMinutes": 30,
    "dayStart": "00:00",
    "dayEnd": "24:00",
    "timeZone": "America/New_York",
    "priorityMode": "weighted",  # "weighted" | "fair"
    "timeBudgetSeconds": 15,
    "compact": True,             # greedy post-pass that pulls blocks earlier (preferEarlier)
}
