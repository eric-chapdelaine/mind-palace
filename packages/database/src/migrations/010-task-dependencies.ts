export const taskDependenciesMigration = {
  version: 10,
  name: "task dependencies",
  sql: String.raw`
    -- A row (task_id = X, depends_on_task_id = Y) means "X depends on Y": Y must be done
    -- (and is scheduled) before X. Pure information for manual completion (no hard gate);
    -- the scheduler consumes the same rows to order prerequisite tasks first.
    CREATE TABLE task_dependencies (
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      depends_on_task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (task_id, depends_on_task_id),
      CHECK (task_id <> depends_on_task_id)
    );

    -- Reverse lookup: everything that depends on a given task.
    CREATE INDEX task_dependencies_required_idx ON task_dependencies(depends_on_task_id, task_id);
  `,
} as const;