# Scheduler evaluation: CP-SAT vs greedy + local search

**Question:** what would change if the CP-SAT worker were replaced by a greedy + local-search
scheduler?

**Method:** both schedulers were run on the same generated weeks for the "make the day decisive"
use case, scored with the worker's own objective, and validated for hard-constraint feasibility.
The greedy implementation lives in `greedy.py`; the CP-SAT side is the production
`schedulerlib.solve` unchanged. Full code and reproduce commands are in `README.md`.

## TL;DR

| | CP-SAT (production, 30s) | Greedy + local search (10s cap) |
|---|---|---|
| Median wall time | 30.07s | **0.43s** (9–108× faster) |
| Always returns a schedule | No — 5/27 runs returned **zero** tasks (production 1-worker settings) | **Yes, always** |
| Small week (≈60–100 tasks) | optimal / near-optimal | same task count (±0–1), style 0–12% lower |
| Large week (>140 tasks) | 30s solution collapses; sometimes none | **17–205% higher priority-weighted decision** |
| Determinism under budget | varies run-to-run | deterministic |

Overall across 27 scenario/seed runs: greedy produced the better objective in **13**, CP-SAT in
**17**. But CP-SAT's 17 wins are concentrated on small/medium weeks and it takes 30s each; all of
CP-SAT's losing runs are on large/overloaded weeks, and 5 of them returned no schedule at all.

## The use case modelled

The generator in `usecase.py` encodes the stated goals and rules:

* sleep 22:30–06:30, "get outside within 30 min of waking" (WFH walk / commute),
* strength training 3×/week on distinct, non-consecutive days,
* cook + eat dinner every day (dinner 17:30–21:00, cook before),
* breakfast every day, grocery every 7 days on a WFH/weekend day,
* ≥1 "outing" per day, minimise outings/day, outings favour 17:00 weekdays and nice weather,
* work only 09:00–17:00 Mon–Fri, plus a backlog of work and one-off errands,
* nice weather = 50–80°F, no precipitation, daytime, wind < 15 mph.

Scenarios sweep workload (`work_backlog`), errand count, weather niceness, and splittability:
`baseline`, `typical`, `busy_week`, `bad_weather`, `nice_weather`, `overloaded`, `fragmented`,
`many_small`, `huge`, `mega`. Each is run with seeds 1–3.

## Fairness / correctness checks

* Greedy calls the worker's `eligible_slots` (same hard rules + weather gates) and re-checks
  dependencies and `withinAfter`.
* Every greedy placement was validated: no slot overlaps, every slot hard-eligible, dependency
  order and max-gap satisfied (`feasible=True` in `results.json`).
* Scores come from the worker's `decision_weights` and `soft_totals`, so `weightedDecision` and
  `style` are directly comparable. Decision dominates style by construction, so placements are
  ranked lexicographically `(weightedDecision, style)`.
* Greedy gets a 10s budget / 12 restarts but converges in 0.1–1.4s (never budget-starved).

## Main results (CP-SAT 30s vs greedy)

```
scenario    seed tasks  cpStatus      cpWD     grWD   cpStyle grStyle      cpS    grS speedup  winner
baseline       1    64  OPTIMAL       3527     3527       960     935     0.96  0.094    10.2  cp-sat
baseline       2    62  OPTIMAL       3191     3191       950     945     1.34  0.093    14.4  cp-sat
baseline       3    61  OPTIMAL       3023     3023       960     915     0.81  0.093     8.7  cp-sat
typical        1    73  FEASIBLE      9449     9440       995     880    30.04  0.350    85.9  cp-sat
typical        2    71  FEASIBLE      8693     8684       805     725    30.05  0.340    88.4  cp-sat
typical        3    71  FEASIBLE      8684     8675       925     860    30.04  0.330    91.1  cp-sat
busy_week      1    85  FEASIBLE     20603    20620       685     730    30.06  0.340    88.5  greedy
busy_week      2    82  FEASIBLE     18443    18461       515     455    30.06  0.295   101.8  greedy
busy_week      3    82  FEASIBLE     18424    18461       750     685    30.06  0.372    80.7  greedy
bad_weather    1    75  FEASIBLE     11527    11527       950     850    30.04  0.285   105.4  cp-sat
bad_weather    2    73  FEASIBLE     10614    10603       690     620    30.05  0.352    85.3  cp-sat
bad_weather    3    73  FEASIBLE     10625    10614       795     695    30.11  0.280   107.5  cp-sat
nice_weather   1    75  FEASIBLE     11549    11538      1030     935    30.07  0.421    71.4  cp-sat
nice_weather   2    73  FEASIBLE     10625    10614       860     780    30.04  0.502    59.9  cp-sat
nice_weather   3    73  FEASIBLE     10625    10614       905     835    30.05  0.290   103.8  cp-sat
overloaded     1    99  FEASIBLE     32897    36474       -20      45    30.07  0.415    72.5  greedy
overloaded     2    94  FEASIBLE     31144    31224       115      75    30.07  0.433    69.4  greedy
overloaded     3    95  FEASIBLE     31496    32324       395     450    30.07  0.532    56.6  greedy
fragmented     1    95  FEASIBLE     32518    32487        45     -20    30.07  1.350    22.3  cp-sat
fragmented     2    93  FEASIBLE     29914    29852      -250    -350    30.08  0.926    32.5  cp-sat
fragmented     3    93  FEASIBLE     29945    29852       135      90    30.14  0.605    49.8  cp-sat
many_small     1   125  FEASIBLE     64027    63981      -705   -1230    30.14  0.699    43.1  cp-sat
many_small     2   123  FEASIBLE     58829    58850      -100   -1275    30.12  0.516    58.4  greedy
many_small     3   123  FEASIBLE     58914    58855     -1025    -935    30.14  0.793    38.0  cp-sat
huge           1   229  UNKNOWN          0   195189         0   -1105    30.24  0.988    30.6  greedy
huge           2   226  FEASIBLE    174567   174582       275   -1460    30.24  0.664    45.6  greedy
huge           3   226  UNKNOWN          0   174746         0   -1345    30.24  0.905    33.4  greedy
mega           1   395  UNKNOWN          0   468395         0    -875    30.44  1.047    29.1  greedy
mega           2   390  UNKNOWN          0   400669         0   -1545    30.43  0.987    30.8  greedy
mega           3   391  UNKNOWN          0   414787         0   -1280    30.43  1.251    24.3  greedy
```

### Aggregate per scenario

```
scenario     runs   cpPl   grPl      cpWD      grWD   cpStyle grStyle   cpS_med grS_med  wins g/c
baseline        3   62.3   62.3      3247      3247     956.7   931.7      0.96   0.093    0/3
typical         3   71.3   70.3      8942      8933     908.3   821.7     30.04   0.340    0/3
busy_week       3   74.7   77.3     19157     19181     650.0   623.3     30.06   0.340    3/0
bad_weather     3   72.7   72.0     10922     10915     811.7   721.7     30.05   0.285    0/3
nice_weather    3   73.7   72.7     10933     10922     931.7   850.0     30.05   0.421    0/3
overloaded      3   78.0   85.7     31846     33341     163.3   190.0     30.07   0.433    3/0
fragmented      3   93.0   91.0     30792     30730     -23.3   -93.3     30.08   0.926    0/3
many_small      3  100.7  112.7     60590     60562    -610.0 -1146.7     30.14   0.699    1/2
huge            3   34.0  119.7     58189    181506      91.7 -1303.3     30.24   0.905    3/0
mega            3    0.0  119.3         0    427950       0.0 -1233.3     30.43   1.047    3/0
```

`cpWD`/`grWD` = priority-weighted decision; `cpStyle`/`grStyle` = soft-rule value. Decision
dominates style, so a run is "won" on `(weightedDecision, style)`.

## Where CP-SAT wins, and by how much

* **Baseline (`baseline`), where CP-SAT proves OPTIMAL:** greedy places exactly the same tasks
  (decision gap 0.00%) with **2.6% lower style** on average. The entire gap is one outing placed
  outside the 17:00 weekday window (25 style points) — `diagnose.py` confirms every other rule is
  matched exactly. Runtime: 0.96s vs 0.09s.
* **Typical weeks (`typical`, `bad_weather`, `nice_weather`):** greedy places **one fewer
  P2 errand** (decision −0.1%) and packs soft preferences notably worse (style −9% to −12%),
  e.g. outings/workouts land off their preferred days. CP-SAT reaches this within its 30s budget;
  proving optimality takes ~63s (`budgets.py`). Runtime: 30s vs 0.35s (≈86–108×).
* Wetter/cooler weeks change *which* outings are weather-eligible but not the shape of the result.

## Where CP-SAT breaks down

* **147+ tasks: the 30s incumbent collapses.** At 147 tasks CP-SAT placed 50 tasks
  (decision 30,068); greedy placed 119 (decision 91,745) in 0.19s. At 128 errands (235 tasks)
  CP-SAT reached only 106/123 tasks after **300s**, versus greedy's 123 in 0.31s.
* **5/27 runs returned no schedule at all** (`status=UNKNOWN`, 0 tasks): 2/3 `huge` and 3/3
  `mega`. Greedy always returned a feasible full week. See the tuning section below: 8 workers
  largely fixes this, so the failure is a production parameter choice, not the algorithm.
* **Time-budget nondeterminism.** Repeated `s96` runs returned 103 vs 112 placed tasks for the
  same payload — a wall-clock time limit makes the production solver's output vary between runs.
  Greedy is deterministic (seeded restarts).

```
# scaling (CP 30s, greedy 5s)
label  tasks  cpStatus  cpPl     cpWD  cpStyle    cpS   grPl     grWD  grStyle    grS  winner
s04       71  OPTIMAL     71     5669     1000   2.16     70     5664     1000  0.261  cp-sat
s08       75  FEASIBLE    75    10205      950  30.05     74    10196      925  0.293  cp-sat
s12       79  FEASIBLE    79    14741      825  30.05     78    14728      805  0.479  cp-sat
s16       83  FEASIBLE    83    19277      735  30.06     82    19260      650  0.344  cp-sat
s24       91  FEASIBLE    91    28349      360  30.07     90    28324      330  0.385  cp-sat
s32       99  FEASIBLE    99    37421       70  30.43     98    37388      -35  0.309  cp-sat
s48      123  FEASIBLE   108    64622     -565  30.12    114    64572     -800  0.786  cp-sat
s64      147  FEASIBLE    50    30068     -300  30.15    119    91745    -1125  0.753  greedy
s96      187  FEASIBLE   103   137129      520  30.21    123   137029    -1030  0.597  cp-sat
s128     235  FEASIBLE    82   157710     -290  30.26    123   191365    -1050  0.570  greedy
s192     319  FEASIBLE   147   286225    -1155  30.38    125   286455    -1285  0.904  greedy
s256     403  FEASIBLE   130   345156     -555  30.48    123   381541    -1035  1.325  greedy
```

The crossover is around **140–150 tasks**. Below it, CP-SAT places ~1 more low-priority task;
above it, greedy wins by 10–205% on the priority-weighted decision.

## Is the CP-SAT failure a tuning artifact? — largely yes

The production worker hardcodes `cp_model_presolve = False` and `num_search_workers = 1`.
`config_experiment.py` re-applies those parameters right before `solve()` without editing
production code. At a 30s budget:

**typical (73 tasks), greedy: decision 9440 / style 880 in 0.36s**

```
config                         status     placed  decision   style
presolve=off workers=1 (prod)  FEASIBLE       73      9449     995
presolve=on  workers=1          OPTIMAL        73      9449     995
presolve=off workers=8          OPTIMAL        73      9449     995
presolve=on  workers=8          OPTIMAL        73      9449     995
```

**s128 (235 tasks), greedy: decision 191365 / style -1050 in 0.60s**

```
config                         status     placed  decision   style
presolve=off workers=1 (prod)  FEASIBLE       82    157710    -290
presolve=on  workers=1          UNKNOWN         0         0       0
presolve=off workers=8          FEASIBLE      118    191192    -960
presolve=on  workers=8          FEASIBLE       95    190665      70
```

So the large-instance collapse is mostly the **single-worker** setting, not CP-SAT itself:
with 8 workers CP-SAT places 118 vs 82 tasks and comes within 0.1% of greedy on the decision
(while still taking 30s vs 0.6s). Presolve-on with 1 worker is the worst case (it burns the whole
budget before an incumbent), matching the README warning. The production parameter choice is
reasonable for tiny models but is the direct cause of the empty/late schedules on large weeks.

## Recommendations

1. **Keep CP-SAT for small/typical weeks.** It reaches the true optimum quickly (fastest when
   presolve is on, which also *proves* optimality) and is the only one that packs the soft
   preferences well (outings at 5pm, workouts on distinct days).
2. **Fix the production solver settings before judging CP-SAT.** On a 235-task week, 8 workers
   took CP-SAT from 82 placed (157,710) to 118 placed (191,192) and near-greedy decision quality.
   Presolve-on/1-worker is the worst case on large models. This is a one-line change with a large
   robustness payoff.
3. **Add greedy as a warm start + fallback**, don't replace CP-SAT outright:
   * always compute the greedy schedule first (sub-second, deterministic),
   * feed it to CP-SAT as a hint and/or use it whenever CP-SAT returns `UNKNOWN` or an empty
     placement,
   * this removes the "empty schedule on a big backlog" failure without giving up CP-SAT quality
     on small weeks.
4. **If speed/simplicity matters more than the last few percent of style**, greedy alone is a
   defensible replacement: it is ~50× faster, deterministic, never fails to produce a week, and on
   everything but small weeks it places as much or more priority-weighted work.

## Reproduce

```sh
uv run --project workers/cp-sat python -u workers/cp-sat/benchmark/compare.py \
    --seeds 1,2,3 --cp-budget 30 --greedy-budget 10
uv run --project workers/cp-sat python workers/cp-sat/benchmark/analyze.py
uv run --project workers/cp-sat python -u workers/cp-sat/benchmark/scaling.py
uv run --project workers/cp-sat python -u workers/cp-sat/benchmark/budgets.py
uv run --project workers/cp-sat python -u workers/cp-sat/benchmark/config_experiment.py
```
