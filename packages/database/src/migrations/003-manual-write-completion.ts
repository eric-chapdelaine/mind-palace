export const manualWriteCompletionMigration = {
  version: 3,
  name: "require human completion after write states",
  sql: String.raw`
    UPDATE workflow_transitions
       SET trigger = 'human_selected'
     WHERE from_state_id IN (
       SELECT id FROM workflow_states WHERE key IN ('create_fix', 'create_change')
     )
       AND to_state_id IN (
       SELECT id FROM workflow_states WHERE key = 'completed'
     );
  `,
} as const;
