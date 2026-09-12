export const normalizePrototypeTasksMigration = {
  version: 8,
  name: "normalize prototype task statuses",
  sql: String.raw`
    UPDATE tasks
       SET kanban_status = CASE lifecycle_status
         WHEN 'completed' THEN 'completed'
         WHEN 'cancelled' THEN 'cancelled'
         WHEN 'paused' THEN 'waiting'
         WHEN 'backlog' THEN 'inbox'
         ELSE kanban_status
       END;

    UPDATE scheduled_jobs SET max_attempts = 3 WHERE max_attempts > 3 AND status IN ('pending', 'running');
  `,
} as const;
