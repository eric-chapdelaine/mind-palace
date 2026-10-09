export const sleepAndActivitiesMigration = {
  version: 8,
  name: "sleep sessions and health activities",
  sql: String.raw`
    CREATE TABLE sleep_sessions (
      id INTEGER PRIMARY KEY,
      public_id TEXT NOT NULL UNIQUE,
      external_id TEXT NOT NULL UNIQUE,
      calendar_date TEXT NOT NULL,
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      sleep_score INTEGER,
      total_sleep_minutes INTEGER,
      deep_sleep_minutes INTEGER,
      light_sleep_minutes INTEGER,
      rem_sleep_minutes INTEGER,
      awake_minutes INTEGER,
      avg_heart_rate INTEGER,
      avg_stress REAL,
      details_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(details_json)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (end_at > start_at)
    );

    CREATE INDEX sleep_sessions_range_idx ON sleep_sessions(start_at, end_at);
    CREATE INDEX sleep_sessions_date_idx ON sleep_sessions(calendar_date DESC);

    CREATE TABLE health_activities (
      id INTEGER PRIMARY KEY,
      public_id TEXT NOT NULL UNIQUE,
      external_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      activity_type TEXT NOT NULL,
      activity_date TEXT NOT NULL,
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      duration_minutes REAL,
      moving_minutes REAL,
      distance_meters REAL,
      calories REAL,
      avg_heart_rate INTEGER,
      max_heart_rate INTEGER,
      details_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(details_json)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (end_at > start_at)
    );

    CREATE INDEX health_activities_range_idx ON health_activities(start_at, end_at);
    CREATE INDEX health_activities_date_idx ON health_activities(activity_date DESC);
  `,
} as const;
