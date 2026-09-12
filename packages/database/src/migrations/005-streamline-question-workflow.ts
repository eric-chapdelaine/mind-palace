export const streamlineQuestionWorkflowMigration = {
  version: 5,
  name: "streamline question workflow",
  sql: String.raw`
    UPDATE workflow_definitions SET active = 0 WHERE key = 'question' AND version = 1;

    INSERT INTO workflow_definitions
      (key, version, name, task_type, description, active, created_at)
    VALUES
      ('question', 2, 'Direct question', 'question',
       'Answer a question directly with the minimum necessary read-only investigation.', 1,
       '2026-09-08T00:00:00.000Z');

    INSERT INTO workflow_states
      (workflow_id, key, name, position, execution_class, prompt_template, completion_criteria,
       auto_start, requires_approval, terminal, created_at)
    VALUES
      ((SELECT id FROM workflow_definitions WHERE key = 'question' AND version = 2),
       'explore_data', 'Answer question', 1, 'research',
       'Answer the question directly. Use the minimum necessary read-only tool calls. Prefer one targeted aggregate query over broad discovery. Do not survey the codebase when a known data source can answer the question, and do not calculate extra time windows or breakdowns unless they materially affect the answer.',
       'The question is answered concisely with the relevant denominator, time range, evidence, and material uncertainty.',
       1, 0, 0, '2026-09-08T00:00:00.000Z'),
      ((SELECT id FROM workflow_definitions WHERE key = 'question' AND version = 2),
       'completed', 'Completed', 2, 'terminal', NULL,
       'The question has a concise, evidence-backed answer.',
       0, 0, 1, '2026-09-08T00:00:00.000Z');

    INSERT INTO workflow_transitions
      (workflow_id, from_state_id, to_state_id, trigger, created_at)
    SELECT workflow.id, source.id, target.id, 'agent_complete', '2026-09-08T00:00:00.000Z'
      FROM workflow_definitions workflow
      JOIN workflow_states source ON source.workflow_id = workflow.id AND source.key = 'explore_data'
      JOIN workflow_states target ON target.workflow_id = workflow.id AND target.key = 'completed'
     WHERE workflow.key = 'question' AND workflow.version = 2;
  `,
} as const;
