export const gateOrientedWorkflowsMigration = {
  version: 6,
  name: "gate oriented bug and feature workflows",
  sql: String.raw`
    UPDATE workflow_definitions
       SET active = 0
     WHERE (key = 'bug' AND version = 1)
        OR (key = 'feature' AND version = 1);

    INSERT INTO workflow_definitions
      (key, version, name, task_type, description, active, created_at)
    VALUES
      ('bug', 2, 'Bug resolution', 'bug',
       'Investigate impact and root cause in one run, then stop only at write and review gates.',
       1, '2026-09-08T00:00:00.000Z'),
      ('feature', 2, 'Feature delivery', 'feature',
       'Understand and plan in one run, then stop only at write and review gates.',
       1, '2026-09-08T00:00:00.000Z');

    INSERT INTO workflow_states
      (workflow_id, key, name, position, execution_class, prompt_template, completion_criteria,
       auto_start, requires_approval, terminal, created_at)
    VALUES
      ((SELECT id FROM workflow_definitions WHERE key = 'bug' AND version = 2),
       'investigate', 'Investigate', 1, 'research',
       'Investigate the bug end to end in one continuous run: understand the report, reproduce or validate examples, assess impact, trace the root cause, decide whether a fix is warranted, and propose the smallest safe fix plus any existing-data remediation. Use targeted evidence and avoid broad surveys or repeated queries. Do not modify files or external systems.',
       'Impact, root cause, fix recommendation, and remediation needs are explicit enough to approve or close the task.',
       1, 0, 0, '2026-09-08T00:00:00.000Z'),
      ((SELECT id FROM workflow_definitions WHERE key = 'bug' AND version = 2),
       'implement', 'Implement approved fix', 2, 'workspace_write',
       'Implement only the approved fix, preserve unrelated work, verify it as directed, and create or update the pull request when appropriate.',
       'The approved fix is implemented, verification is documented, and review or merge is the only remaining gate.',
       0, 1, 0, '2026-09-08T00:00:00.000Z'),
      ((SELECT id FROM workflow_definitions WHERE key = 'bug' AND version = 2),
       'waiting_pr', 'Review and merge', 3, 'external_write', NULL,
       'CI and review are complete and the fix is merged, deployed, or intentionally closed.',
       0, 0, 0, '2026-09-08T00:00:00.000Z'),
      ((SELECT id FROM workflow_definitions WHERE key = 'bug' AND version = 2),
       'completed', 'Completed', 4, 'terminal', NULL,
       'The task has no remaining action.',
       0, 0, 1, '2026-09-08T00:00:00.000Z'),

      ((SELECT id FROM workflow_definitions WHERE key = 'feature' AND version = 2),
       'plan', 'Understand and plan', 1, 'research',
       'Understand the requested behavior and design the implementation in one continuous run. Inspect only relevant code and context, resolve dependencies and edge cases, and propose the smallest maintainable change with rollout and verification needs. Do not modify files or external systems.',
       'The implementation direction, affected areas, risks, and verification approach are explicit enough to approve.',
       1, 0, 0, '2026-09-08T00:00:00.000Z'),
      ((SELECT id FROM workflow_definitions WHERE key = 'feature' AND version = 2),
       'implement', 'Implement approved change', 2, 'workspace_write',
       'Implement only the approved plan, preserve unrelated work, verify it as directed, and create or update the pull request when appropriate.',
       'The approved change is implemented, verification is documented, and review or merge is the only remaining gate.',
       0, 1, 0, '2026-09-08T00:00:00.000Z'),
      ((SELECT id FROM workflow_definitions WHERE key = 'feature' AND version = 2),
       'waiting_pr', 'Review and merge', 3, 'external_write', NULL,
       'CI and review are complete and the change is merged, deployed, or intentionally closed.',
       0, 0, 0, '2026-09-08T00:00:00.000Z'),
      ((SELECT id FROM workflow_definitions WHERE key = 'feature' AND version = 2),
       'completed', 'Completed', 4, 'terminal', NULL,
       'The task has no remaining action.',
       0, 0, 1, '2026-09-08T00:00:00.000Z');

    INSERT INTO workflow_transitions
      (workflow_id, from_state_id, to_state_id, trigger, created_at)
    SELECT workflow.id, source.id, target.id, transitions.trigger, '2026-09-08T00:00:00.000Z'
      FROM workflow_definitions workflow
      JOIN (
        SELECT 'bug' AS workflow_key, 'investigate' AS source_key, 'implement' AS target_key, 'agent_complete' AS trigger
        UNION ALL SELECT 'bug', 'implement', 'waiting_pr', 'agent_complete'
        UNION ALL SELECT 'bug', 'waiting_pr', 'completed', 'human_selected'
        UNION ALL SELECT 'feature', 'plan', 'implement', 'agent_complete'
        UNION ALL SELECT 'feature', 'implement', 'waiting_pr', 'agent_complete'
        UNION ALL SELECT 'feature', 'waiting_pr', 'completed', 'human_selected'
      ) transitions ON transitions.workflow_key = workflow.key
      JOIN workflow_states source ON source.workflow_id = workflow.id AND source.key = transitions.source_key
      JOIN workflow_states target ON target.workflow_id = workflow.id AND target.key = transitions.target_key
     WHERE workflow.version = 2;
  `,
} as const;
