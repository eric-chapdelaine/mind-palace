import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TaskRepository } from "@mind-palace/database";
import type { Schedule, ScheduleScores, ScheduleUnscheduled, WeatherForecast } from "@mind-palace/shared";
import { runPythonWorker } from "./worker.js";
import type { WeatherService } from "./weather-service.js";

interface SolverResult {
  modelVersion: string;
  horizonStart: string;
  horizonEnd: string;
  assignments: Assignment[];
  unscheduled: ScheduleUnscheduled[];
  unscheduledTaskIds: number[];
  scores: ScheduleScores;
  solverStatus: string;
  objectiveValue: number;
  error?: string;
}

interface Assignment {
  taskId: number;
  startAt: string;
  endAt: string;
}

/**
 * Collapse adjacent solver slots for the same task into one block. The worker models time in
 * fixed slots (e.g. two 30-minute slots), but a block of work is a contiguous span: 10:00-10:30
 * plus 10:30-11:00 is a single 10:00-11:00 block. The API and UI both read blocks, so the merge
 * happens once here instead of being re-done by every consumer.
 */
export function mergeAssignments(assignments: Assignment[]): Assignment[] {
  const sorted = [...assignments].sort((left, right) => left.startAt.localeCompare(right.startAt) || left.taskId - right.taskId);
  const merged: Assignment[] = [];
  for (const assignment of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && previous.taskId === assignment.taskId && previous.endAt === assignment.startAt) {
      previous.endAt = assignment.endAt;
    } else {
      merged.push({ ...assignment });
    }
  }
  return merged;
}

/** How far ahead the worker lays out slots. Sent in the payload so a run is reproducible. */
const HORIZON_DAYS = 7;

/**
 * Solver configuration. The worker owns the defaults (slot size, day window, timezone); the
 * control plane only states the choices that are product decisions. Kept in the payload so the
 * stored run is self-describing.
 *
 * `timeBudgetSeconds` is the solver's soft time limit (the worker defaults to 15s). It is raised
 * to 30s because the Raspberry Pi needs the extra budget to place the same tasks the dev machine
 * solves in a few seconds.
 */
const SCHEDULER_TIME_BUDGET_SECONDS = 30;
const SCHEDULER_CONFIG = { priorityMode: "weighted", timeBudgetSeconds: SCHEDULER_TIME_BUDGET_SECONDS } as const;

/**
 * Hard wall-clock cap for the worker process. Must exceed `timeBudgetSeconds` plus `uv` startup
 * and model build (a few seconds on the Pi); otherwise the child is SIGTERM'd mid-solve and the
 * request fails before the worker can print its result.
 */
const WORKER_TIMEOUT_MS = 60_000;

export class ScheduleService {
  private readonly workerDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../workers/cp-sat");

  constructor(private readonly tasks: TaskRepository, private readonly weather: WeatherService) {}

  getSchedule(): Schedule {
    const latest = this.tasks.latestScheduleResult();
    return {
      runs: this.tasks.listScheduleRuns(),
      timeBlocks: this.tasks.listTimeBlocks(),
      unscheduled: latest.unscheduled,
      scores: latest.scores,
      unscheduledTaskIds: latest.unscheduled.map((entry) => entry.taskId),
    };
  }

  async generate(): Promise<Schedule> {
    // Release time held by stale proposals first so listSchedulableTasks (and the solver)
    // see an accurate remaining estimate; the new proposed blocks re-claim it below.
    this.tasks.supersedeProposedBlocks();
    const now = new Date();
    // Weather rules are optional: if NWS is unreachable and nothing is cached, schedule without.
    // Send only the horizon window (plus a day of slack) so the payload stays bounded as the
    // forecast cache grows.
    let weather: WeatherForecast[] = [];
    try {
      // Floor the start to the hour: the worker looks weather up by the slot's UTC hour, so the
      // current hour's forecast must be included even though it starts before `now`.
      const weatherFrom = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
      const horizonEnd = new Date(now.getTime() + (HORIZON_DAYS + 1) * 86_400_000);
      weather = await this.weather.getWeather(false, weatherFrom.toISOString(), horizonEnd.toISOString());
    } catch {
      weather = [];
    }
    const input = {
      now: now.toISOString(),
      horizonDays: HORIZON_DAYS,
      config: SCHEDULER_CONFIG,
      tasks: this.tasks.listSchedulableTasks(),
      // The solver only needs live blocks; superseded/missed rows are history, not constraints.
      timeBlocks: this.tasks.listTimeBlocks().filter((block) => block.status !== "superseded" && block.status !== "missed"),
      weather,
      rules: this.tasks.listSchedulerRules(),
    };
    const result = await this.runSolver(input);
    const run = this.tasks.createScheduleRun(result.horizonStart, result.horizonEnd, input, result.modelVersion);
    try {
      for (const assignment of mergeAssignments(result.assignments)) {
        this.tasks.createTimeBlock({ ...assignment, source: "solver", status: "proposed" }, run.id);
      }
      this.tasks.finishScheduleRun(run.id, result);
    } catch (error) {
      this.tasks.finishScheduleRun(run.id, null, error instanceof Error ? error.message : String(error));
      throw error;
    }
    return this.getSchedule();
  }

  private runSolver(input: unknown): Promise<SolverResult> {
    return runPythonWorker<SolverResult>({
      directory: this.workerDirectory,
      script: "scheduler.py",
      input,
      timeoutMs: WORKER_TIMEOUT_MS,
      label: "CP-SAT worker",
    });
  }
}
