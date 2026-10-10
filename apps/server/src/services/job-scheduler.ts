export type JobSchedule =
  /** Fixed daily wall-clock times in `timeZone`, each `"HH:MM"`. */
  | { kind: "times"; at: string[]; timeZone: string }
  /** Fixed interval measured from the end of the previous run. */
  | { kind: "interval"; everyMs: number };

export interface ScheduledJob {
  /** Stable id, used as the log prefix and in `GET /api/jobs`. */
  name: string;
  /** When to run — pinned local times, or an interval. */
  schedule: JobSchedule;
  /** Invoke once shortly after startup, for idempotent/cache-aware work missed while the server was down. */
  runOnStart?: boolean;
  run: () => Promise<void> | void;
}

export interface ScheduledJobStatus {
  name: string;
  schedule: JobSchedule;
  nextRunAt: string | null;
  running: boolean;
  runCount: number;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastError: string | null;
}

interface JobRuntime {
  job: ScheduledJob;
  timer: NodeJS.Timeout | null;
  startupTimer: NodeJS.Timeout | null;
  nextRunAt: Date | null;
  running: boolean;
  runCount: number;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastError: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

/** Offset (ms) of `timeZone` from UTC at `date`; positive east of Greenwich. */
function zoneOffsetMs(timeZone: string, date: Date): number {
  let formatter = offsetFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    offsetFormatters.set(timeZone, formatter);
  }
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) parts[part.type] = part.value;
  const asUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second),
  );
  return asUtc - date.getTime();
}

/** Next instant after `now` whose wall clock in `timeZone` matches `"HH:MM"`. */
function nextDailyTime(now: Date, time: string, timeZone: string): Date {
  const [hour, minute] = time.split(":").map(Number);
  const offset = zoneOffsetMs(timeZone, now);
  const wall = new Date(now.getTime() + offset);
  let wallCandidate = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate(), hour, minute, 0);
  if (wallCandidate <= wall.getTime()) wallCandidate += DAY_MS;
  // Convert wall → UTC twice: the offset at `now` may differ from the offset at the target (DST).
  let candidate = wallCandidate - offset;
  candidate = wallCandidate - zoneOffsetMs(timeZone, new Date(candidate));
  return new Date(candidate);
}

/** Pure: the next fire time strictly after `now` for a schedule. Exported for tests. */
export function computeNextRun(schedule: JobSchedule, now: Date): Date {
  if (schedule.kind === "interval") return new Date(now.getTime() + schedule.everyMs);
  let earliest = Infinity;
  for (const time of schedule.at) {
    const candidate = nextDailyTime(now, time, schedule.timeZone).getTime();
    if (candidate < earliest) earliest = candidate;
  }
  return new Date(earliest);
}

/**
 * Minimal in-process cron. The schedule is the `ScheduledJob[]` built in `jobs.ts`, so it is
 * versioned with the repo instead of living in a machine's crontab. Jobs are expected to be
 * idempotent and cheap when there is nothing to do, so a restart is harmless. A single timer per
 * job is rescheduled after each run, which keeps pinned wall-clock times from drifting.
 */
export class JobScheduler {
  private readonly runtimes: JobRuntime[];

  constructor(jobs: ScheduledJob[]) {
    this.runtimes = jobs.map((job) => ({
      job,
      timer: null,
      startupTimer: null,
      nextRunAt: null,
      running: false,
      runCount: 0,
      lastStartedAt: null,
      lastFinishedAt: null,
      lastError: null,
    }));
  }

  start(): void {
    for (const runtime of this.runtimes) {
      if (runtime.job.runOnStart) {
        runtime.startupTimer = setTimeout(() => {
          runtime.startupTimer = null;
          void this.execute(runtime);
        }, 0);
        runtime.startupTimer.unref();
      } else {
        this.scheduleNext(runtime);
      }
    }
  }

  stop(): void {
    for (const runtime of this.runtimes) {
      if (runtime.timer) clearTimeout(runtime.timer);
      if (runtime.startupTimer) clearTimeout(runtime.startupTimer);
      runtime.timer = null;
      runtime.startupTimer = null;
    }
  }

  status(): ScheduledJobStatus[] {
    return this.runtimes.map((runtime) => ({
      name: runtime.job.name,
      schedule: runtime.job.schedule,
      nextRunAt: runtime.nextRunAt?.toISOString() ?? null,
      running: runtime.running,
      runCount: runtime.runCount,
      lastStartedAt: runtime.lastStartedAt,
      lastFinishedAt: runtime.lastFinishedAt,
      lastError: runtime.lastError,
    }));
  }

  private scheduleNext(runtime: JobRuntime): void {
    const now = new Date();
    runtime.nextRunAt = computeNextRun(runtime.job.schedule, now);
    runtime.timer = setTimeout(() => void this.execute(runtime), Math.max(0, runtime.nextRunAt.getTime() - now.getTime()));
    runtime.timer.unref();
  }

  private async execute(runtime: JobRuntime): Promise<void> {
    if (runtime.running) {
      console.warn(`[jobs] ${runtime.job.name} is still running; skipping this tick`);
      this.scheduleNext(runtime);
      return;
    }
    runtime.running = true;
    runtime.lastStartedAt = new Date().toISOString();
    try {
      await runtime.job.run();
      runtime.lastError = null;
    } catch (error) {
      runtime.lastError = error instanceof Error ? error.message : String(error);
      console.error(`[jobs] ${runtime.job.name} failed:`, runtime.lastError);
    } finally {
      runtime.running = false;
      runtime.lastFinishedAt = new Date().toISOString();
      runtime.runCount += 1;
      this.scheduleNext(runtime);
    }
  }
}
