export const fixedTimeToTimeBlockTypeMigration = {
  version: 6,
  name: "fixed task windows become typed time blocks",
  // Rebuilding `tasks` requires dropping it while child tables hold foreign keys
  // to it, so the runner toggles foreign_keys off around this migration (same as
  // 003/005). Old `fixed_start`/`fixed_end` rows are carried over as accepted
  // `calendar_event` time blocks before the columns are dropped, and the tasks'
  // remaining work is set to 0 (the block already holds the whole window).
  foreignKeysOff: true,
  sql: String.raw`
    -- Capture fixed windows that have no time block yet (imports already created one).
    CREATE TABLE _migration_fixed_windows (
      task_id INTEGER PRIMARY KEY,
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL
    );
    INSERT INTO _migration_fixed_windows (task_id, start_at, end_at)
      SELECT id, fixed_start, fixed_end FROM tasks
      WHERE fixed_start IS NOT NULL AND fixed_end IS NOT NULL
        AND id NOT IN (SELECT task_id FROM time_blocks);

    CREATE TABLE tasks_new (
      id INTEGER PRIMARY KEY,
      public_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT,
      kanban_status TEXT NOT NULL DEFAULT 'inbox'
        CHECK (kanban_status IN ('inbox', 'ready', 'in_progress', 'waiting', 'completed', 'cancelled')),
      lifecycle_status TEXT NOT NULL DEFAULT 'active'
        CHECK (lifecycle_status IN ('backlog', 'active', 'paused', 'completed', 'cancelled', 'archived')),
      priority INTEGER NOT NULL DEFAULT 0,
      rank REAL NOT NULL DEFAULT 0,
      duration_minutes_remaining INTEGER CHECK (duration_minutes_remaining IS NULL OR duration_minutes_remaining >= 0),
      duration_estimated INTEGER NOT NULL DEFAULT 0 CHECK (duration_estimated IN (0, 1)),
      splittable INTEGER NOT NULL DEFAULT 0 CHECK (splittable IN (0, 1)),
      min_chunk_minutes INTEGER CHECK (min_chunk_minutes IS NULL OR min_chunk_minutes > 0),
      max_chunk_minutes INTEGER CHECK (max_chunk_minutes IS NULL OR max_chunk_minutes >= min_chunk_minutes),
      earliest_start TEXT,
      deadline_at TEXT,
      completed_at TEXT,
      origin TEXT NOT NULL DEFAULT 'manual',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    INSERT INTO tasks_new
      (id, public_id, title, description, kanban_status, lifecycle_status, priority, rank,
       duration_minutes_remaining, duration_estimated, splittable, min_chunk_minutes, max_chunk_minutes,
       earliest_start, deadline_at, completed_at, origin, created_at, updated_at)
      SELECT id, public_id, title, description, kanban_status, lifecycle_status, priority, rank,
       CASE WHEN fixed_start IS NOT NULL AND fixed_end IS NOT NULL THEN 0 ELSE duration_minutes END,
       duration_estimated, splittable, min_chunk_minutes, max_chunk_minutes,
       earliest_start, deadline_at, completed_at, origin, created_at, updated_at
      FROM tasks;

    DROP TABLE tasks;
    ALTER TABLE tasks_new RENAME TO tasks;

    CREATE INDEX tasks_kanban_idx ON tasks(kanban_status, priority DESC, rank DESC);

    ALTER TABLE time_blocks ADD COLUMN type TEXT NOT NULL DEFAULT 'work'
      CHECK (type IN ('work', 'calendar_event'));

    -- Manually-fixed tasks become accepted calendar commitment blocks.
    INSERT INTO time_blocks
      (public_id, task_id, schedule_run_id, start_at, end_at, status, source, type, notes, created_at, updated_at)
      SELECT
        lower(hex(randomblob(16))), task_id, NULL, start_at, end_at, 'accepted', 'calendar', 'calendar_event', NULL,
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM _migration_fixed_windows;

    -- Existing provider-imported blocks get the calendar_event type.
    UPDATE time_blocks SET type = 'calendar_event' WHERE source = 'calendar';

    DROP TABLE _migration_fixed_windows;
  `,
} as const;