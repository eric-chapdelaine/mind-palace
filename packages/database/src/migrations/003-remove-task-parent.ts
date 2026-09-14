export const removeTaskParentMigration = {
  version: 3,
  name: "remove task parent (subtasks -> tags)",
  // Rebuilding `tasks` requires dropping it while child tables hold foreign keys
  // to it; with FK enforcement on that would cascade-delete their rows. The
  // migrate runner toggles foreign_keys off around this migration and re-enables
  // after commit. No data is touched — the table is rebuilt verbatim minus the
  // parent_task_id column.
  foreignKeysOff: true,
  sql: String.raw`
    CREATE TABLE tasks_new (
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
      origin TEXT NOT NULL DEFAULT 'manual',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    INSERT INTO tasks_new
      (id, public_id, title, description, kanban_status, lifecycle_status, priority, rank,
       duration_minutes, duration_estimated, splittable, min_chunk_minutes, max_chunk_minutes,
       earliest_start, deadline_at, fixed_start, fixed_end, completed_at, origin, created_at, updated_at)
      SELECT id, public_id, title, description, kanban_status, lifecycle_status, priority, rank,
       duration_minutes, duration_estimated, splittable, min_chunk_minutes, max_chunk_minutes,
       earliest_start, deadline_at, fixed_start, fixed_end, completed_at, origin, created_at, updated_at
      FROM tasks;

    DROP TABLE tasks;
    ALTER TABLE tasks_new RENAME TO tasks;

    CREATE INDEX tasks_kanban_idx ON tasks(kanban_status, priority DESC, rank DESC);
  `,
} as const;