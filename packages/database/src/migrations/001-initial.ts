export const initialMigration = {
  version: 1,
  name: "mind palace core schema",
  sql: String.raw`
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY,
      public_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT,
      kanban_status TEXT NOT NULL DEFAULT 'inbox'
        CHECK (kanban_status IN ('inbox', 'ready', 'in_progress', 'waiting', 'in_review', 'completed', 'cancelled')),
      lifecycle_status TEXT NOT NULL DEFAULT 'active'
        CHECK (lifecycle_status IN ('backlog', 'active', 'paused', 'completed', 'cancelled', 'archived')),
      priority INTEGER NOT NULL DEFAULT 0,
      rank REAL NOT NULL DEFAULT 0,
      duration_minutes INTEGER CHECK (duration_minutes IS NULL OR duration_minutes > 0),
      duration_estimated INTEGER NOT NULL DEFAULT 0 CHECK (duration_estimated IN (0, 1)),
      splittable INTEGER NOT NULL DEFAULT 0 CHECK (splittable IN (0, 1)),
      min_chunk_minutes INTEGER CHECK (min_chunk_minutes IS NULL OR min_chunk_minutes > 0),
      max_chunk_minutes INTEGER CHECK (max_chunk_minutes IS NULL OR max_chunk_minutes >= min_chunk_minutes),
      earliest_start TEXT,
      deadline_at TEXT,
      fixed_start TEXT,
      fixed_end TEXT,
      completed_at TEXT,
      parent_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
      origin TEXT NOT NULL DEFAULT 'manual',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (parent_task_id IS NULL OR parent_task_id <> id)
    );

    CREATE INDEX tasks_kanban_idx ON tasks(kanban_status, priority DESC, rank DESC);
    CREATE INDEX tasks_parent_idx ON tasks(parent_task_id);

    CREATE TABLE tags (
      id INTEGER PRIMARY KEY,
      public_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX tags_title_unique ON tags(title COLLATE NOCASE);

    CREATE TABLE tag_parents (
      child_tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      parent_tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (child_tag_id, parent_tag_id),
      CHECK (child_tag_id <> parent_tag_id)
    );

    CREATE TABLE task_tags (
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'integration', 'system')),
      created_at TEXT NOT NULL,
      PRIMARY KEY (task_id, tag_id)
    );

    CREATE INDEX task_tags_tag_idx ON task_tags(tag_id, task_id);

    CREATE TABLE recurrence_rules (
      id INTEGER PRIMARY KEY,
      task_id INTEGER NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
      frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly')),
      interval_count INTEGER NOT NULL DEFAULT 1 CHECK (interval_count > 0),
      weekdays_json TEXT CHECK (weekdays_json IS NULL OR json_valid(weekdays_json)),
      local_start_time TEXT,
      next_occurrence_date TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE recurrence_occurrences (
      recurrence_rule_id INTEGER NOT NULL REFERENCES recurrence_rules(id) ON DELETE CASCADE,
      occurrence_date TEXT NOT NULL,
      child_task_id INTEGER NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (recurrence_rule_id, occurrence_date)
    );

    CREATE TABLE schedule_runs (
      id INTEGER PRIMARY KEY,
      public_id TEXT NOT NULL UNIQUE,
      model_version TEXT NOT NULL,
      horizon_start TEXT NOT NULL,
      horizon_end TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
      input_json TEXT NOT NULL CHECK (json_valid(input_json)),
      result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
      error TEXT,
      created_at TEXT NOT NULL,
      finished_at TEXT
    );

    CREATE TABLE time_blocks (
      id INTEGER PRIMARY KEY,
      public_id TEXT NOT NULL UNIQUE,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      schedule_run_id INTEGER REFERENCES schedule_runs(id) ON DELETE SET NULL,
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'proposed'
        CHECK (status IN ('proposed', 'accepted', 'completed', 'missed', 'superseded')),
      source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'solver', 'calendar', 'recurrence')),
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (end_at > start_at)
    );

    CREATE INDEX time_blocks_range_idx ON time_blocks(start_at, end_at, status);
    CREATE INDEX time_blocks_task_idx ON time_blocks(task_id, status, start_at);

    CREATE TABLE integration_accounts (
      id INTEGER PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('google_calendar', 'garmin', 'weather')),
      external_account_id TEXT,
      status TEXT NOT NULL DEFAULT 'configured' CHECK (status IN ('configured', 'healthy', 'error', 'disabled')),
      config_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(config_json)),
      sync_cursor TEXT,
      last_synced_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (kind, external_account_id)
    );

    CREATE TABLE external_task_mappings (
      id INTEGER PRIMARY KEY,
      integration_account_id INTEGER NOT NULL REFERENCES integration_accounts(id) ON DELETE CASCADE,
      external_id TEXT NOT NULL,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      external_updated_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (integration_account_id, external_id)
    );

    CREATE TABLE health_observations (
      id INTEGER PRIMARY KEY,
      public_id TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('activity', 'sleep')),
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      external_id TEXT,
      details_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(details_json)),
      created_at TEXT NOT NULL,
      UNIQUE (source, external_id)
    );

    CREATE INDEX health_observations_range_idx ON health_observations(start_at, end_at);

    CREATE TABLE weather_forecasts (
      id INTEGER PRIMARY KEY,
      location_key TEXT NOT NULL,
      forecast_at TEXT NOT NULL,
      temperature_f INTEGER,
      precipitation_probability INTEGER,
      short_forecast TEXT,
      fetched_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      UNIQUE (location_key, forecast_at)
    );

    INSERT INTO tags (public_id, title, description, created_at, updated_at) VALUES
      ('mind-palace:calendar-event', 'calendar_event', 'Fixed or externally managed calendar commitment.', '2026-09-10T00:00:00.000Z', '2026-09-10T00:00:00.000Z'),
      ('mind-palace:routine', 'routine', 'Template task that creates recurring child tasks.', '2026-09-10T00:00:00.000Z', '2026-09-10T00:00:00.000Z'),
      ('mind-palace:work', 'work', 'Work context.', '2026-09-10T00:00:00.000Z', '2026-09-10T00:00:00.000Z'),
      ('mind-palace:health', 'health', 'Health context.', '2026-09-10T00:00:00.000Z', '2026-09-10T00:00:00.000Z'),
      ('mind-palace:outside', 'outside', 'Outdoor activity context.', '2026-09-10T00:00:00.000Z', '2026-09-10T00:00:00.000Z');
  `,
} as const;