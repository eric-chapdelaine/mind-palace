export const taskWorktreeIntentMigration = {
  version: 4,
  name: "add task worktree intent",
  sql: String.raw`
    ALTER TABLE tasks
      ADD COLUMN is_new_worktree INTEGER NOT NULL DEFAULT 0 CHECK (is_new_worktree IN (0, 1));
  `,
} as const;
