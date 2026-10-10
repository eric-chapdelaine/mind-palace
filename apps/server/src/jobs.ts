import type { GarminService } from "./services/garmin-service.js";
import type { ScheduledJob } from "./services/job-scheduler.js";
import type { WeatherService } from "./services/weather-service.js";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/**
 * Every recurring background job the server runs. Add an entry here to schedule new work — the
 * schedule deliberately lives in this file (not in a machine's crontab) so it is versioned and
 * copied with the repo. `GET /api/jobs` reports last-run status for each.
 *
 * Jobs must be idempotent: a restart can fire `runOnStart`, and an interval tick can land at any
 * moment. Prefer a cheap "is anything actually due?" check inside `run` over doing work on every tick.
 */
export function scheduledJobs({ weather, garmin }: { weather: WeatherService; garmin: GarminService }): ScheduledJob[] {
  return [
    {
      name: "weather-refresh",
      // Forecast rows expire 8h after a fetch. Poll hourly with a cache-aware check rather than
      // every 8h: the network is only hit once the TTL has actually lapsed, and a tick landing just
      // before expiry would otherwise skip a full cycle and leave the cache stale for ~16h.
      intervalMs: 1 * HOUR,
      runOnStart: true,
      run: () => weather.ensureFresh(),
    },
    {
      name: "garmin-sync",
      // Incremental and idempotent; a daily cadence is enough. No `runOnStart` so editing files
      // during dev doesn't re-sync on every reload. No-ops until the token store exists.
      intervalMs: 24 * HOUR,
      run: async () => {
        if (!garmin.status().connected) return;
        await garmin.sync();
      },
    },
  ];
}
