from dataclasses import dataclass
from typing import Optional


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
    last_verdict: Optional[str]


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
    total_reps = 0
    total_prescribed = result.prescribed_sets * result.prescribed_reps
    
    for i in range(result.prescribed_sets):
        if i < len(result.sets):
            total_reps += result.sets[i].reps_completed
    
    if total_prescribed == 0:
        avg_completion = 0.0
    else:
        avg_completion = total_reps / total_prescribed
    
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
        avg_completion_pct=avg_completion
    )


if __name__ == "__main__":
    p = Prescription(
        exercise_id=1,
        prescribed_sets=3,
        prescribed_reps=8,
        current_weight_lbs=100,
        increment_lbs=5,
        consecutive_fails=0,
        consecutive_close=0,
        last_verdict=None
    )
    
    r = SessionResult(
        exercise_id=1,
        sets=[
            SetResult(1, 8, 100),
            SetResult(2, 8, 100),
            SetResult(3, 7, 100)
        ],
        prescribed_sets=3,
        prescribed_reps=8
    )
    
    result = evaluate(p, r)
    assert result.verdict == "close", f"Expected close, got {result.verdict}"
    assert result.next_weight_lbs == 100, f"Expected 100, got {result.next_weight_lbs}"
    assert result.avg_completion_pct == 0.958, f"Expected 0.958, got {result.avg_completion_pct}"
    
    p2 = Prescription(
        exercise_id=1,
        prescribed_sets=3,
        prescribed_reps=8,
        current_weight_lbs=100,
        increment_lbs=5,
        consecutive_fails=0,
        consecutive_close=1,
        last_verdict="close"
    )
    
    result2 = evaluate(p2, r)
    assert result2.verdict == "pass", f"Expected pass, got {result2.verdict}"
    assert result2.next_weight_lbs == 105, f"Expected 105, got {result2.next_weight_lbs}"
    
    r_fail = SessionResult(
        exercise_id=1,
        sets=[
            SetResult(1, 5, 100),
            SetResult(2, 4, 100),
            SetResult(3, 3, 100)
        ],
        prescribed_sets=3,
        prescribed_reps=8
    )
    
    result3 = evaluate(p, r_fail)
    assert result3.verdict == "fail", f"Expected fail, got {result3.verdict}"
    assert result3.next_weight_lbs == 100, f"Expected 100, got {result3.next_weight_lbs}"
    assert result3.consecutive_fails == 1, f"Expected 1, got {result3.consecutive_fails}"
    
    p_fail = Prescription(
        exercise_id=1,
        prescribed_sets=3,
        prescribed_reps=8,
        current_weight_lbs=100,
        increment_lbs=5,
        consecutive_fails=2,
        consecutive_close=0,
        last_verdict="fail"
    )
    
    result4 = evaluate(p_fail, r_fail)
    assert result4.verdict == "fail", f"Expected fail, got {result4.verdict}"
    assert result4.consecutive_fails == 3, f"Expected 3, got {result4.consecutive_fails}"
    
    result5 = evaluate(p_fail, r_fail)
    assert result5.verdict == "deload", f"Expected deload, got {result5.verdict}"
    assert result5.next_weight_lbs == 90, f"Expected 90, got {result5.next_weight_lbs}"
    assert result5.consecutive_fails == 0, f"Expected 0, got {result5.consecutive_fails}"
    
    print("All assertions passed!")
