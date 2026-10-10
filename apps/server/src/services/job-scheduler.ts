export interface ScheduledJob {
  /** Stable id, used as the log prefix and in `GET /api/jobs`. */
  name: string;
  /** How often to invoke `run`. */
  intervalMs: number;
  /** Invoke once shortly after startup, for idempotent/cache-aware work missed while the server was down. */
  runOnStart?: boolean;
  run: () => Promise<void> | void;
}

export interface ScheduledJobStatus {
  name: string;
  intervalMs: number;
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
  running: boolean;
  runCount: number;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastError: string | null;
}

/**
 * Minimal in-process cron. The schedule is the `ScheduledJob[]` built in `jobs.ts`, so it is
 * versioned with the repo instead of living in a machine's crontab. Jobs are expected to be
 * idempotent and cheap when there is nothing to do, so a restart or a `runOnStart` is harmless.
 */
export class JobScheduler {
  private readonly runtimes: JobRuntime[];

  constructor(jobs: ScheduledJob[]) {
    this.runtimes = jobs.map((job) => ({
      job,
      timer: null,
      startupTimer: null,
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
        runtime.startupTimer = setTimeout(() => void this.execute(runtime), 0);
        runtime.startupTimer.unref();
      }
      runtime.timer = setInterval(() => void this.execute(runtime), runtime.job.intervalMs);
      runtime.timer.unref();
    }
  }

  stop(): void {
    for (const runtime of this.runtimes) {
      if (runtime.timer) clearInterval(runtime.timer);
      if (runtime.startupTimer) clearTimeout(runtime.startupTimer);
      runtime.timer = null;
      runtime.startupTimer = null;
    }
  }

  status(): ScheduledJobStatus[] {
    return this.runtimes.map((runtime) => ({
      name: runtime.job.name,
      intervalMs: runtime.job.intervalMs,
      running: runtime.running,
      runCount: runtime.runCount,
      lastStartedAt: runtime.lastStartedAt,
      lastFinishedAt: runtime.lastFinishedAt,
      lastError: runtime.lastError,
    }));
  }

  private async execute(runtime: JobRuntime): Promise<void> {
    if (runtime.running) {
      console.warn(`[jobs] ${runtime.job.name} is still running; skipping this tick`);
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
    }
  }
}
