const now = "2026-09-08T00:00:00.000Z";

export const seedWorkflowsMigration = {
  version: 2,
  name: "seed workflows and resources",
  sql: String.raw`
    INSERT INTO workflow_definitions (key, version, name, task_type, description, created_at) VALUES
      ('bug', 1, 'Bug investigation', 'bug', 'Assess impact and root cause before proposing a fix.', '${now}'),
      ('feature', 1, 'Feature delivery', 'feature', 'Understand, plan, and implement a product change.', '${now}'),
      ('question', 1, 'Question investigation', 'question', 'Gather code and data evidence to answer a question.', '${now}');

    INSERT INTO workflow_states
      (workflow_id, key, name, position, execution_class, prompt_template, completion_criteria, auto_start, requires_approval, terminal, created_at)
    VALUES
      ((SELECT id FROM workflow_definitions WHERE key = 'bug' AND version = 1), 'gather_info', 'Gather information', 1, 'research',
       'Inspect the provided examples and relevant code. Establish concrete facts without modifying files or external systems.',
       'Relevant examples, code paths, and unknowns are documented.', 1, 0, 0, '${now}'),
      ((SELECT id FROM workflow_definitions WHERE key = 'bug' AND version = 1), 'assess_impact', 'Assess impact', 2, 'research',
       'Assess frequency, affected users or records, severity, and scope. Use read-only data sources where useful.',
       'Impact and confidence are quantified enough to make a fix decision.', 1, 0, 0, '${now}'),
      ((SELECT id FROM workflow_definitions WHERE key = 'bug' AND version = 1), 'root_cause', 'Find root cause', 3, 'research',
       'Trace affected examples through the code and data flow. Identify the precise failure condition and propose the smallest safe remedy.',
       'The root cause, evidence, fix recommendation, and existing-data remedy are explicit.', 1, 0, 0, '${now}'),
      ((SELECT id FROM workflow_definitions WHERE key = 'bug' AND version = 1), 'create_fix', 'Create fix', 4, 'workspace_write',
       'Implement the approved smallest safe fix. Do not broaden scope. Report changed files, verification, and any remediation needed for existing records.',
       'The approved fix is implemented and its verification status is documented.', 0, 1, 0, '${now}'),
      ((SELECT id FROM workflow_definitions WHERE key = 'bug' AND version = 1), 'completed', 'Completed', 5, 'terminal',
       NULL, 'The fix is merged or the task was intentionally closed.', 0, 0, 1, '${now}'),

      ((SELECT id FROM workflow_definitions WHERE key = 'feature' AND version = 1), 'gather_info', 'Gather information', 1, 'research',
       'Understand the requested behavior, current implementation, users, constraints, and unknowns. Do not modify files.',
       'The requested behavior and relevant current-state code are understood.', 1, 0, 0, '${now}'),
      ((SELECT id FROM workflow_definitions WHERE key = 'feature' AND version = 1), 'plan', 'Plan change', 2, 'research',
       'Design the smallest maintainable implementation. Resolve dependencies, edge cases, rollout concerns, and verification approach.',
       'An implementation-ready plan and any remaining decisions are explicit.', 1, 0, 0, '${now}'),
      ((SELECT id FROM workflow_definitions WHERE key = 'feature' AND version = 1), 'create_change', 'Create change', 3, 'workspace_write',
       'Implement the approved plan with minimal, maintainable changes. Report changed files and verification status.',
       'The approved change is implemented and its verification status is documented.', 0, 1, 0, '${now}'),
      ((SELECT id FROM workflow_definitions WHERE key = 'feature' AND version = 1), 'completed', 'Completed', 4, 'terminal',
       NULL, 'The change is merged or the task was intentionally closed.', 0, 0, 1, '${now}'),

      ((SELECT id FROM workflow_definitions WHERE key = 'question' AND version = 1), 'gather_info', 'Gather information', 1, 'research',
       'Gather the codebase and domain context needed to answer the question. Do not modify files or external systems.',
       'The relevant context and data needs are known.', 1, 0, 0, '${now}'),
      ((SELECT id FROM workflow_definitions WHERE key = 'question' AND version = 1), 'explore_data', 'Explore data', 2, 'research',
       'Use read-only code, logs, metrics, and database queries as needed. Answer with evidence, caveats, and exact references.',
       'The question is answered with evidence and material uncertainty is stated.', 1, 0, 0, '${now}'),
      ((SELECT id FROM workflow_definitions WHERE key = 'question' AND version = 1), 'completed', 'Completed', 3, 'terminal',
       NULL, 'The question has a durable answer.', 0, 0, 1, '${now}');

    INSERT INTO workflow_transitions (workflow_id, from_state_id, to_state_id, trigger, created_at)
    SELECT w.id, f.id, t.id, 'agent_complete', '${now}'
      FROM workflow_definitions w
      JOIN workflow_states f ON f.workflow_id = w.id
      JOIN workflow_states t ON t.workflow_id = w.id
     WHERE (w.key = 'bug' AND (f.key || ':' || t.key) IN ('gather_info:assess_impact', 'assess_impact:root_cause', 'root_cause:create_fix', 'create_fix:completed'))
        OR (w.key = 'feature' AND (f.key || ':' || t.key) IN ('gather_info:plan', 'plan:create_change', 'create_change:completed'))
        OR (w.key = 'question' AND (f.key || ':' || t.key) IN ('gather_info:explore_data', 'explore_data:completed'));

    INSERT INTO resources (key, name, description, created_at) VALUES
      ('nile-webapps-local-ui', 'NileWebApps local UI', 'Exclusive local frontend and Playwright capacity.', '${now}');
  `,
} as const;
