"""Read results.json / scaling.json and print the comparison tables + aggregates."""

from __future__ import annotations

import json
import statistics
from pathlib import Path


def winner(cp, gr):
    """Lexicographic (weightedDecision, style) compare. Decision dominates by construction."""
    cp_key = (cp["weightedDecision"], cp["style"])
    gr_key = (gr["weightedDecision"], gr["style"])
    if gr_key > cp_key:
        return "greedy"
    if gr_key < cp_key:
        return "cp-sat"
    return "tie"


def load(path):
    return json.loads(Path(path).read_text())


def report(results):
    rows = results["rows"]
    print(f"# CP budget={results['cpBudgetSeconds']}s, greedy budget={results['greedyBudgetSeconds']}s\n")
    print(f"{'scenario':<12}{'seed':>4}{'tasks':>6}  {'cpStatus':<9}{'cpWD':>9}{'grWD':>9}  "
          f"{'cpStyle':>8}{'grStyle':>8}  {'cpS':>7}{'grS':>7}{'speedup':>8}  {'winner':<7}")
    for row in rows:
        cp, gr = row["cp"], row["greedy"]
        speedup = cp["wallSeconds"] / gr["totalSeconds"] if gr["totalSeconds"] else float("inf")
        print(f"{row['scenario']:<12}{row['seed']:>4}{row['tasks']:>6}  {cp['solverStatus']:<9}"
              f"{cp['weightedDecision']:>9}{gr['weightedDecision']:>9}  {cp['style']:>8}{gr['style']:>8}  "
              f"{cp['wallSeconds']:>7.2f}{gr['totalSeconds']:>7.3f}{speedup:>8.1f}  {winner(cp, gr):<7}")

    print("\n## Aggregate per scenario\n")
    print(f"{'scenario':<12}{'runs':>5}{'cpPl':>7}{'grPl':>7}{'cpWD':>10}{'grWD':>10}  "
          f"{'cpStyle':>8}{'grStyle':>8}  {'cpS_med':>8}{'grS_med':>8}  {'wins g/c/t':>10}")
    by_scenario = {}
    for row in rows:
        by_scenario.setdefault(row["scenario"], []).append(row)
    for name, group in by_scenario.items():
        wins = {"greedy": 0, "cp-sat": 0, "tie": 0}
        for row in group:
            wins[winner(row["cp"], row["greedy"])] += 1
        print(f"{name:<12}{len(group):>5}"
              f"{statistics.mean(r['cp']['placed'] for r in group):>7.1f}"
              f"{statistics.mean(r['greedy']['placed'] for r in group):>7.1f}"
              f"{statistics.mean(r['cp']['weightedDecision'] for r in group):>10.0f}"
              f"{statistics.mean(r['greedy']['weightedDecision'] for r in group):>10.0f}  "
              f"{statistics.mean(r['cp']['style'] for r in group):>8.1f}"
              f"{statistics.mean(r['greedy']['style'] for r in group):>8.1f}  "
              f"{statistics.median(r['cp']['wallSeconds'] for r in group):>8.2f}"
              f"{statistics.median(r['greedy']['totalSeconds'] for r in group):>8.3f}  "
              f"{wins['greedy']:>3}/{wins['cp-sat']}/{wins['tie']}")

    overall = {"greedy": 0, "cp-sat": 0, "tie": 0}
    for row in rows:
        overall[winner(row["cp"], row["greedy"])] += 1
    print(f"\nOverall wins: greedy={overall['greedy']} cp-sat={overall['cp-sat']} tie={overall['tie']}")

    optimal = [r for r in rows if r["cp"]["solverStatus"] == "OPTIMAL"]
    if optimal:
        gaps = []
        for row in optimal:
            cp, gr = row["cp"], row["greedy"]
            gaps.append((gr["weightedDecision"] / cp["weightedDecision"] - 1) * 100 if cp["weightedDecision"] else 0)
        print(f"\nWhere CP-SAT proved OPTIMAL ({len(optimal)} runs): "
              f"greedy decision gap mean={statistics.mean(gaps):+.3f}% max={max(gaps):+.3f}%")
        style_gaps = [(r["greedy"]["style"] / r["cp"]["style"] - 1) * 100 for r in optimal if r["cp"]["style"]]
        if style_gaps:
            print(f"  greedy style gap mean={statistics.mean(style_gaps):+.2f}% max={max(style_gaps):+.2f}%")

    failed = [r for r in rows if r["cp"]["solverStatus"] == "UNKNOWN" or r["cp"]["placed"] == 0]
    print(f"\nCP-SAT runs with no/empty solution: {len(failed)} "
          f"({sorted({r['scenario'] for r in failed})})")
    for row in rows:
        cp, gr = row["cp"], row["greedy"]
        if cp["weightedDecision"] and gr["weightedDecision"] > cp["weightedDecision"]:
            gain = (gr["weightedDecision"] / cp["weightedDecision"] - 1) * 100
            if gain > 5:
                print(f"  greedy beats CP-SAT incumbent by {gain:+.1f}%: {row['scenario']}/{row['seed']} "
                      f"({gr['weightedDecision']} vs {cp['weightedDecision']})")


def report_scaling(scaling):
    print("\n\n# Scaling\n")
    print(f"{'label':<6}{'tasks':>6}  {'cpStatus':<9}{'cpPl':>5}{'cpWD':>9}{'cpStyle':>9}{'cpS':>7}  "
          f"{'grPl':>5}{'grWD':>9}{'grStyle':>9}{'grS':>7}  {'winner':<7}")
    for row in scaling["rows"]:
        cp, gr = row["cp"], row["greedy"]
        print(f"{row['label']:<6}{row['tasks']:>6}  {cp['solverStatus']:<9}{cp['placed']:>5}"
              f"{cp['weightedDecision']:>9}{cp['style']:>9}{cp['wallSeconds']:>7.2f}  "
              f"{gr['placed']:>5}{gr['weightedDecision']:>9}{gr['style']:>9}"
              f"{gr['totalSeconds']:>7.3f}  {winner(cp, gr):<7}")


if __name__ == "__main__":
    report(load("workers/cp-sat/benchmark/results.json"))
    report_scaling(load("workers/cp-sat/benchmark/scaling.json"))
