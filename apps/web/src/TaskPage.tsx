import type { TaskDetail, TaskSummary, Workflow } from "@opencode-task-manager/shared";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Tag } from "@opencode-task-manager/shared";
import { api, type Resource } from "./api";
import { StatusPill } from "./components/StatusPill";
import { TaskEditor } from "./components/TaskEditor";

export function TaskPage() {
  const id = Number(useParams().id);
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);

  async function load() {
    try {
      const [nextTask, nextTasks, nextWorkflows, nextResources, nextTags] = await Promise.all([
        api.task(id), api.tasks(), api.workflows(), api.resources(), api.tags(),
      ]);
      setTask(nextTask);
      setTasks(nextTasks);
      setWorkflows(nextWorkflows);
      setResources(nextResources);
      setTags(nextTags);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), 2000);
    return () => window.clearInterval(interval);
  }, [id]);

  async function action(operation: () => Promise<TaskDetail>) {
    try {
      setTask(await operation());
      setError(null);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    }
  }

  if (!task) return <main className="detail-shell"><Link to="/">Back</Link>{error ? <div className="error-banner">{error}</div> : <p>Loading...</p>}</main>;
  const workflow = workflows.find((item) => item.key === task.workflowKey && item.version === task.workflowVersion);
  const currentState = workflow?.states.find((state) => state.key === task.workflowState);

  return (
    <main className="detail-shell">
      <nav className="detail-nav"><Link to="/">Back to board</Link><span>{task.publicId.slice(0, 8)}</span></nav>
      {error && <div className="error-banner">{error}</div>}
      {task.agentStatus === "failed" && task.failureReason && <div className="error-banner"><strong>Previous agent attempt failed</strong><p>{task.failureReason}</p><button onClick={() => void action(() => api.runTask(id))}>Retry agent</button></div>}
      <header className="detail-header">
        <div><div className="task-card-topline"><span className="task-type">{task.kanbanStatus.replace("_", " ")}</span>{(task.agentEligible || task.automationEnabled) && <StatusPill status={task.agentStatus} />}</div><h1>{task.title}</h1>{task.description && <div className="markdown-description"><ReactMarkdown remarkPlugins={[remarkGfm]}>{task.description}</ReactMarkdown></div>}<div className="tag-row">{task.tags.map((tag) => <span key={tag.id}>{tag.title}</span>)}</div>{task.derivedTags.length > 0 && <div className="tag-row derived-tags">{task.derivedTags.map((tag) => <span key={tag.id}>{tag.title}</span>)}</div>}</div>
        <div className="detail-actions">
          <button onClick={() => setEditing((current) => !current)}>{editing ? "Close editor" : "Edit task"}</button>
          {task.automationEnabled && (task.lifecycleStatus === "paused" ? <button className="primary-button" onClick={() => void action(() => api.resumeTask(id))}>Resume agent</button> : <button onClick={() => void action(() => api.pauseTask(id))}>Pause agent</button>)}
          {task.agentEligible && !task.automationEnabled && <button onClick={() => void action(() => api.startAgent(id))}>Send to agent</button>}
          {task.automationEnabled && task.agentStatus !== "running" && task.agentStatus !== "failed" && task.lifecycleStatus === "active" && currentState?.promptTemplate && <button onClick={() => void action(() => api.runTask(id))}>Run current state</button>}
          {task.kanbanStatus !== "completed" && <button className="primary-button" onClick={() => void action(() => api.updateTask(id, { kanbanStatus: "completed" }))}>Mark completed</button>}
          <button onClick={() => void action(() => api.setLifecycle(id, "archived"))}>Archive</button>
        </div>
      </header>

      {editing && <TaskEditor task={task} tags={tags} onCancel={() => setEditing(false)} onSave={async (input) => { await action(() => api.updateTask(id, input)); setEditing(false); }} />}

      {task.agentEligible && task.automationEnabled && <section className="workflow-strip">
        {workflow?.states.map((state) => {
          const currentPosition = workflow.states.find((item) => item.key === task.workflowState)?.position ?? 0;
          return <div className={`workflow-step ${state.key === task.workflowState ? "current" : ""} ${state.position < currentPosition ? "passed" : ""}`} key={state.key}><span>{state.position}</span><strong>{state.name}</strong></div>;
        })}
      </section>}

      <div className="detail-grid">
        <div className="detail-main">
          {task.agentEligible && task.approvals.filter((approval) => approval.status === "pending").map((approval) => (
            <section className="attention-panel approval-panel" key={approval.id}><div className="section-label">Approval required</div><h2>{approval.description}</h2><pre>{JSON.stringify(approval.proposedAction, null, 2)}</pre><div className="button-row"><button className="primary-button" onClick={() => void action(() => api.decideApproval(approval.id, "approve"))}>Approve once</button><button onClick={() => void action(() => api.decideApproval(approval.id, "reject"))}>Reject</button></div></section>
          ))}
          {task.agentEligible && task.interactions.filter((interaction) => interaction.status === "pending").map((interaction) => <InteractionPanel key={interaction.id} interaction={interaction} onReply={(response) => action(() => api.replyInteraction(interaction.id, response))} />)}

          {task.agentEligible && <section className="detail-section"><h2>Agent runs</h2>{task.runs.length === 0 ? <p className="muted">No runs yet.</p> : <div className="timeline">{task.runs.map((run) => <article key={run.id}><span className={`timeline-mark run-${run.status}`} /><div><div className="timeline-title"><strong>{run.stateKey}</strong><span>{run.status}</span><time>{new Date(run.createdAt).toLocaleString()}</time></div>{run.summary && <p>{run.summary}</p>}{run.error && <p className="error-text">{run.error}</p>}</div></article>)}</div>}</section>}
          <details className="detail-section history-details"><summary>State history</summary><div className="transition-list">{task.transitions.map((transition) => <div key={transition.id}><time>{new Date(transition.createdAt).toLocaleString()}</time><strong>{transition.fromState ?? "created"} to {transition.toState}</strong><span>{transition.summary}</span></div>)}</div></details>
        </div>

        <aside className="detail-sidebar">
          <section><div className="section-label">Planning</div><strong>Priority {task.priority}</strong>{task.durationMinutes !== null && <span>{task.durationMinutes} minutes{task.splittable ? ", splittable" : ""}</span>}{task.durationMinutes === null && <span>No time estimate</span>}{task.deadlineAt && <span>Due {new Date(task.deadlineAt).toLocaleString()}</span>}</section>
          {task.timeBlocks.length > 0 && <section><div className="section-label">Time blocks</div>{task.timeBlocks.filter((block) => block.status !== "superseded").map((block) => <div className="mini-block" key={block.id}><strong>{new Date(block.startAt).toLocaleString()}</strong><span>{block.status}</span></div>)}{task.timeBlocks.some((block) => block.status === "proposed") && <button onClick={() => void api.acceptTaskSchedule(task.id).then(() => load())}>Accept schedule</button>}</section>}
          {task.agentEligible && <><section><h2>Workspace</h2><strong>{task.workspaceName}</strong><code>{task.directory}</code><span className="muted">{task.isNewWorktree ? "New worktree requested" : "Use existing checkout"}</span></section>
          <section><h2>OpenCode session</h2>{task.attachCommand ? <><code className="command-block">{task.attachCommand}</code><button onClick={() => { void navigator.clipboard.writeText(task.attachCommand ?? ""); setCopied(true); window.setTimeout(() => setCopied(false), 1200); }}>{copied ? "Copied" : "Copy attach command"}</button></> : <p className="muted">Created when the first run starts.</p>}</section>
          <DependencyPanel task={task} tasks={tasks} workflows={workflows} onAdded={load} />
          <ResourcePanel task={task} resources={resources} workflow={workflow} onAdded={load} />
          {task.artifacts.length > 0 && <section><h2>Evidence and artifacts</h2>{task.artifacts.map((artifact) => <a className="artifact-link" href={artifact.uri} key={artifact.id} target="_blank" rel="noreferrer">{artifact.label}</a>)}</section>}</>}
        </aside>
      </div>
    </main>
  );
}

function InteractionPanel({ interaction, onReply }: { interaction: TaskDetail["interactions"][number]; onReply: (response: unknown) => Promise<void> }) {
  const [response, setResponse] = useState("");
  return <section className="attention-panel question-panel"><div className="section-label">{interaction.kind === "permission" ? "OpenCode permission" : "Agent question"}</div><h2>{interaction.prompt}</h2>{interaction.kind === "permission" ? <div className="button-row"><button className="primary-button" onClick={() => void onReply("once")}>Allow once</button><button onClick={() => void onReply("reject")}>Reject</button></div> : <form onSubmit={(event) => { event.preventDefault(); void onReply(response); }}><textarea value={response} onChange={(event) => setResponse(event.target.value)} rows={4} required /><button className="primary-button">Reply and continue</button></form>}</section>;
}

function DependencyPanel({ task, tasks, workflows, onAdded }: { task: TaskDetail; tasks: TaskSummary[]; workflows: Workflow[]; onAdded: () => Promise<void> }) {
  const [blockerId, setBlockerId] = useState("");
  const [stateKey, setStateKey] = useState("");
  const blocker = tasks.find((item) => item.id === Number(blockerId));
  const states = workflows.find((workflow) => workflow.key === blocker?.workflowKey && workflow.version === blocker.workflowVersion)?.states ?? [];
  async function submit(event: FormEvent) { event.preventDefault(); await api.addDependency(task.id, Number(blockerId), stateKey); setBlockerId(""); setStateKey(""); await onAdded(); }
  return <section><div className="section-label">Dependencies</div>{task.dependencies.map((dependency) => <div className="dependency" key={dependency.id}><strong>{dependency.blockerTitle}</strong><span>{dependency.satisfiedAt ? "Satisfied" : `Waiting for ${dependency.requiredState}`}</span></div>)}<form className="compact-form" onSubmit={submit}><select value={blockerId} onChange={(event) => { setBlockerId(event.target.value); setStateKey(""); }} required><option value="">Blocking task...</option>{tasks.filter((item) => item.id !== task.id).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select><select value={stateKey} onChange={(event) => setStateKey(event.target.value)} required><option value="">Required state...</option>{states.map((state) => <option key={state.key} value={state.key}>{state.name}</option>)}</select><button>Add dependency</button></form></section>;
}

function ResourcePanel({ task, resources, workflow, onAdded }: { task: TaskDetail; resources: Resource[]; workflow: Workflow | undefined; onAdded: () => Promise<void> }) {
  const [resourceId, setResourceId] = useState("");
  const [stateKey, setStateKey] = useState("");
  async function submit(event: FormEvent) { event.preventDefault(); await api.addResource(task.id, Number(resourceId), stateKey || undefined); setResourceId(""); setStateKey(""); await onAdded(); }
  return <section><div className="section-label">Exclusive resources</div>{resources.map((resource) => <div className="resource-row" key={resource.id}><span>{resource.name}</span><i className={resource.leasedByTaskId ? "leased" : "free"}>{resource.leasedByTaskId ? "leased" : "free"}</i></div>)}<form className="compact-form" onSubmit={submit}><select value={resourceId} onChange={(event) => setResourceId(event.target.value)} required><option value="">Resource...</option>{resources.map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}</select><select value={stateKey} onChange={(event) => setStateKey(event.target.value)}><option value="">Every state</option>{workflow?.states.filter((state) => !state.terminal).map((state) => <option key={state.key} value={state.key}>{state.name}</option>)}</select><button>Require resource</button></form></section>;
}
