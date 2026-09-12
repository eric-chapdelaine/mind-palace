export const initialMigration = {
  version: 1,
  name: "initial orchestration schema",
  sql: String.raw`
    CREATE TABLE workspaces (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      directory TEXT NOT NULL UNIQUE,
      repository TEXT,
      default_branch TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE workflow_definitions (
      id INTEGER PRIMARY KEY,
      key TEXT NOT NULL,
      version INTEGER NOT NULL,
      name TEXT NOT NULL,
      task_type TEXT NOT NULL CHECK (task_type IN ('bug', 'feature', 'question')),
      description TEXT,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at TEXT NOT NULL,
      UNIQUE (key, version)
    );

    CREATE TABLE workflow_states (
      id INTEGER PRIMARY KEY,
      workflow_id INTEGER NOT NULL REFERENCES workflow_definitions(id),
      key TEXT NOT NULL,
      name TEXT NOT NULL,
      position INTEGER NOT NULL,
      execution_class TEXT NOT NULL CHECK (execution_class IN ('research', 'workspace_write', 'external_write', 'terminal')),
      prompt_template TEXT,
      completion_criteria TEXT,
      auto_start INTEGER NOT NULL DEFAULT 1 CHECK (auto_start IN (0, 1)),
      requires_approval INTEGER NOT NULL DEFAULT 0 CHECK (requires_approval IN (0, 1)),
      terminal INTEGER NOT NULL DEFAULT 0 CHECK (terminal IN (0, 1)),
      created_at TEXT NOT NULL,
      UNIQUE (workflow_id, key),
      UNIQUE (workflow_id, position)
    );

    CREATE TABLE workflow_transitions (
      id INTEGER PRIMARY KEY,
      workflow_id INTEGER NOT NULL REFERENCES workflow_definitions(id),
      from_state_id INTEGER NOT NULL REFERENCES workflow_states(id),
      to_state_id INTEGER NOT NULL REFERENCES workflow_states(id),
      trigger TEXT NOT NULL CHECK (trigger IN ('agent_complete', 'human_approved', 'human_selected', 'external_event')),
      condition_json TEXT CHECK (condition_json IS NULL OR json_valid(condition_json)),
      created_at TEXT NOT NULL,
      UNIQUE (from_state_id, to_state_id, trigger)
    );

    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY,
      public_id TEXT NOT NULL UNIQUE,
      workflow_id INTEGER NOT NULL REFERENCES workflow_definitions(id),
      current_state_id INTEGER NOT NULL REFERENCES workflow_states(id),
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
      title TEXT NOT NULL,
      title_source TEXT NOT NULL DEFAULT 'prompt' CHECK (title_source IN ('prompt', 'generated', 'manual')),
      initial_prompt TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      lifecycle_status TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle_status IN ('backlog', 'active', 'paused', 'completed', 'cancelled', 'archived')),
      agent_status TEXT NOT NULL DEFAULT 'not_started' CHECK (agent_status IN ('not_started', 'queued', 'running', 'idle', 'waiting_input', 'waiting_approval', 'blocked', 'failed', 'stopped')),
      automation_policy TEXT NOT NULL DEFAULT 'stop_before_writes' CHECK (automation_policy IN ('manual', 'stop_before_writes', 'through_pr', 'fully_automatic')),
      model TEXT,
      agent TEXT,
      wiki_path TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX tasks_dashboard_idx ON tasks(lifecycle_status, agent_status, updated_at DESC);

    CREATE TABLE task_dependencies (
      id INTEGER PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      blocker_task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      required_state_id INTEGER NOT NULL REFERENCES workflow_states(id),
      satisfied_at TEXT,
      created_at TEXT NOT NULL,
      CHECK (task_id <> blocker_task_id),
      UNIQUE (task_id, blocker_task_id, required_state_id)
    );

    CREATE INDEX task_dependencies_blocked_idx ON task_dependencies(task_id, satisfied_at);

    CREATE TABLE task_state_transitions (
      id INTEGER PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      from_state_id INTEGER REFERENCES workflow_states(id),
      to_state_id INTEGER NOT NULL REFERENCES workflow_states(id),
      cause TEXT NOT NULL CHECK (cause IN ('created', 'agent_result', 'approval', 'manual', 'dependency', 'external_event')),
      actor_type TEXT NOT NULL CHECK (actor_type IN ('system', 'agent', 'user')),
      actor_id TEXT,
      agent_run_id INTEGER,
      summary TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX task_state_history_idx ON task_state_transitions(task_id, created_at DESC);

    CREATE TABLE opencode_servers (
      id INTEGER PRIMARY KEY,
      endpoint TEXT NOT NULL UNIQUE,
      pid INTEGER,
      version TEXT,
      status TEXT NOT NULL CHECK (status IN ('starting', 'healthy', 'unhealthy', 'stopped')),
      started_at TEXT,
      last_heartbeat_at TEXT,
      stopped_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE opencode_sessions (
      id INTEGER PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      server_id INTEGER NOT NULL REFERENCES opencode_servers(id),
      opencode_session_id TEXT NOT NULL UNIQUE,
      parent_session_id INTEGER REFERENCES opencode_sessions(id),
      role TEXT NOT NULL DEFAULT 'primary' CHECK (role IN ('primary', 'fork', 'recovery')),
      title TEXT NOT NULL,
      directory TEXT NOT NULL,
      model TEXT,
      agent TEXT,
      last_known_status TEXT,
      tmux_session TEXT,
      tmux_window TEXT,
      tmux_pane TEXT,
      created_at TEXT NOT NULL,
      last_seen_at TEXT,
      closed_at TEXT
    );

    CREATE UNIQUE INDEX one_open_primary_session_per_task
      ON opencode_sessions(task_id) WHERE role = 'primary' AND closed_at IS NULL;

    CREATE TABLE agent_runs (
      id INTEGER PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      workflow_state_id INTEGER NOT NULL REFERENCES workflow_states(id),
      opencode_session_id INTEGER NOT NULL REFERENCES opencode_sessions(id),
      trigger TEXT NOT NULL CHECK (trigger IN ('initial', 'state_entry', 'user_resume', 'retry', 'pr_followup', 'recovery')),
      status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'waiting_input', 'waiting_approval', 'failed', 'aborted', 'lost')),
      prompt TEXT NOT NULL,
      opencode_message_id TEXT,
      outcome TEXT CHECK (outcome IS NULL OR outcome IN ('state_complete', 'needs_input', 'blocked', 'action_proposed', 'failed')),
      summary TEXT,
      result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
      proposed_next_state TEXT,
      error TEXT,
      started_at TEXT,
      heartbeat_at TEXT,
      finished_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX agent_runs_task_idx ON agent_runs(task_id, created_at DESC);
    CREATE UNIQUE INDEX one_running_agent_run_per_task ON agent_runs(task_id) WHERE status = 'running';

    CREATE TABLE interaction_requests (
      id INTEGER PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      agent_run_id INTEGER REFERENCES agent_runs(id),
      kind TEXT NOT NULL CHECK (kind IN ('question', 'permission')),
      opencode_request_id TEXT,
      prompt TEXT NOT NULL,
      request_json TEXT CHECK (request_json IS NULL OR json_valid(request_json)),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'answered', 'rejected', 'expired')),
      response_json TEXT CHECK (response_json IS NULL OR json_valid(response_json)),
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );

    CREATE UNIQUE INDEX interaction_native_request_idx ON interaction_requests(opencode_request_id) WHERE opencode_request_id IS NOT NULL;
    CREATE INDEX pending_interactions_idx ON interaction_requests(task_id, status);

    CREATE TABLE approval_requests (
      id INTEGER PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      agent_run_id INTEGER REFERENCES agent_runs(id),
      workflow_state_id INTEGER NOT NULL REFERENCES workflow_states(id),
      action_type TEXT NOT NULL CHECK (action_type IN ('enter_write_state', 'workspace_change', 'create_pr', 'external_change', 'followup_fix')),
      scope TEXT NOT NULL DEFAULT 'once' CHECK (scope IN ('once', 'state')),
      description TEXT NOT NULL,
      proposed_action_json TEXT NOT NULL CHECK (json_valid(proposed_action_json)),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
      requested_at TEXT NOT NULL,
      resolved_at TEXT,
      resolved_by TEXT,
      consumed_at TEXT
    );

    CREATE UNIQUE INDEX one_pending_approval_per_task_action
      ON approval_requests(task_id, workflow_state_id, action_type) WHERE status = 'pending';

    CREATE TABLE resources (
      id INTEGER PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE task_resource_requirements (
      id INTEGER PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      workflow_state_id INTEGER REFERENCES workflow_states(id),
      resource_id INTEGER NOT NULL REFERENCES resources(id),
      created_at TEXT NOT NULL,
      UNIQUE (task_id, workflow_state_id, resource_id)
    );

    CREATE TABLE resource_leases (
      id INTEGER PRIMARY KEY,
      resource_id INTEGER NOT NULL REFERENCES resources(id),
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      agent_run_id INTEGER REFERENCES agent_runs(id),
      acquired_at TEXT NOT NULL,
      heartbeat_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      released_at TEXT,
      release_reason TEXT
    );

    CREATE UNIQUE INDEX one_active_lease_per_resource ON resource_leases(resource_id) WHERE released_at IS NULL;

    CREATE TABLE artifacts (
      id INTEGER PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      agent_run_id INTEGER REFERENCES agent_runs(id),
      kind TEXT NOT NULL CHECK (kind IN ('file', 'commit', 'pull_request', 'report', 'wiki_page', 'deployment', 'external_url')),
      label TEXT NOT NULL,
      uri TEXT NOT NULL,
      metadata_json TEXT CHECK (metadata_json IS NULL OR json_valid(metadata_json)),
      created_at TEXT NOT NULL,
      UNIQUE (task_id, kind, uri)
    );

    CREATE TABLE pull_requests (
      id INTEGER PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      repository TEXT NOT NULL,
      number INTEGER NOT NULL,
      url TEXT NOT NULL UNIQUE,
      branch TEXT,
      base_branch TEXT,
      status TEXT NOT NULL CHECK (status IN ('open', 'merged', 'closed', 'draft')),
      ci_status TEXT CHECK (ci_status IS NULL OR ci_status IN ('pending', 'passing', 'failing', 'cancelled', 'unknown')),
      review_status TEXT,
      last_polled_at TEXT,
      merged_at TEXT,
      deployed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (repository, number)
    );

    CREATE TABLE pull_request_observations (
      id INTEGER PRIMARY KEY,
      pull_request_id INTEGER NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('ci', 'review', 'bugbot', 'merge', 'deployment')),
      external_id TEXT,
      status TEXT,
      summary TEXT,
      payload_json TEXT CHECK (payload_json IS NULL OR json_valid(payload_json)),
      observed_at TEXT NOT NULL
    );

    CREATE TABLE scheduled_jobs (
      id INTEGER PRIMARY KEY,
      task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('start_state', 'poll_pull_request', 'reconcile_session', 'expire_lease')),
      payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
      run_after TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      locked_at TEXT,
      locked_by TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      finished_at TEXT
    );

    CREATE INDEX runnable_jobs_idx ON scheduled_jobs(status, run_after);

    CREATE TABLE audit_events (
      id INTEGER PRIMARY KEY,
      task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      actor_type TEXT NOT NULL CHECK (actor_type IN ('system', 'agent', 'user', 'external')),
      actor_id TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
      created_at TEXT NOT NULL
    );

    CREATE INDEX audit_events_task_idx ON audit_events(task_id, created_at DESC);
  `,
} as const;
