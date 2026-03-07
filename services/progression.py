"""Lift progression evaluation engine.

Evaluates workout completion and adjusts weights:
- PASS  (>=95% completion): increase weight by increment
- CLOSE (>=80% completion): stay same, promote to PASS after 2 consecutive
- FAIL  (<80% completion): stay same, DELOAD after 3 consecutive
"""
from dataclasses import dataclass


@dataclass
class SetResult:
    set_number: int
    reps_completed: int
    weight_lbs: float


@dataclass
class Prescription:
    exercise_id: int
    prescribed_sets: int
    prescribed_reps: int
    current_weight_lbs: float
    increment_lbs: float
    consecutive_fails: int
    consecutive_close: int
    last_verdict: str | None


@dataclass
class SessionResult:
    exercise_id: int
    sets: list[SetResult]
    prescribed_sets: int
    prescribed_reps: int


@dataclass
class EvaluationResult:
    verdict: str
    next_weight_lbs: float
    consecutive_fails: int
    consecutive_close: int
    avg_completion_pct: float


def evaluate(prescription: Prescription, result: SessionResult) -> EvaluationResult:
    """Evaluate a completed session and return progression verdict."""
    total_reps = 0
    total_prescribed = result.prescribed_sets * result.prescribed_reps

    for i in range(result.prescribed_sets):
        if i < len(result.sets):
            total_reps += result.sets[i].reps_completed

    avg_completion = total_reps / total_prescribed if total_prescribed else 0.0

    if avg_completion >= 0.95:
        verdict = "pass"
    elif avg_completion >= 0.80:
        verdict = "close"
    else:
        verdict = "fail"

    new_consecutive_fails = prescription.consecutive_fails
    new_consecutive_close = prescription.consecutive_close
    next_weight = prescription.current_weight_lbs

    if verdict == "pass":
        new_consecutive_fails = 0
        new_consecutive_close = 0
        next_weight = prescription.current_weight_lbs + prescription.increment_lbs
    elif verdict == "close":
        new_consecutive_close += 1
        new_consecutive_fails = 0
        if new_consecutive_close >= 2:
            verdict = "pass"
            next_weight = prescription.current_weight_lbs + prescription.increment_lbs
            new_consecutive_close = 0
    elif verdict == "fail":
        new_consecutive_fails += 1
        new_consecutive_close = 0
        if new_consecutive_fails >= 3:
            verdict = "deload"
            next_weight = prescription.current_weight_lbs * 0.9
            new_consecutive_fails = 0

    return EvaluationResult(
        verdict=verdict,
        next_weight_lbs=next_weight,
        consecutive_fails=new_consecutive_fails,
        consecutive_close=new_consecutive_close,
        avg_completion_pct=avg_completion,
    )
