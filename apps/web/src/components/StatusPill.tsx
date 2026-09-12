import type { AgentStatus } from "@opencode-task-manager/shared";

const labels: Record<AgentStatus, string> = {
  not_started: "Not started",
  queued: "Queued",
  running: "Agent running",
  idle: "Agent stopped",
  waiting_input: "Needs input",
  waiting_approval: "Needs approval",
  blocked: "Blocked",
  failed: "Failed",
  stopped: "Stopped",
};

export function StatusPill({ status }: { status: AgentStatus }) {
  return <span className={`status-pill status-${status}`}>{labels[status]}</span>;
}
