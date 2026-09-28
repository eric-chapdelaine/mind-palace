import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import { reservedTagPublicIds, type KanbanStatus, type Tag, type TaskSummary } from "@mind-palace/shared";
import { createClient } from "./api";
import { loadConfig, saveConfig, type TuiConfig } from "./config";
import { editInEditor, editorName } from "./editor";
import { matchTags } from "./fuzzy";
import { ColumnHeader, TagRow, TagSearchRow, TaskRow } from "./components/Rows";
import { HelpOverlay, NewTagModal, NewTaskModal, type NewTaskPayload } from "./components/modals";

const COLUMNS: ReadonlyArray<{ status: KanbanStatus; label: string }> = [
  { status: "inbox", label: "Inbox" },
  { status: "ready", label: "Ready" },
  { status: "in_progress", label: "In progress" },
  { status: "waiting", label: "Waiting" },
];
const OPEN_KANBAN = new Set<KanbanStatus>(["inbox", "ready", "in_progress", "waiting"]);

type Modal = "new-task" | "new-tag" | "help";

type Row =
  | { kind: "header"; key: string; label: string; count: number; hint?: string }
  | { kind: "task"; key: string; task: TaskSummary }
  | { kind: "tag"; key: string; tag: Tag }
  | { kind: "tagSearch"; key: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function App() {
  // ---- setup: config, client, ink handles ----
  const [config] = useState<TuiConfig>(() => loadConfig());
  const client = useMemo(() => createClient(config.apiUrl), [config.apiUrl]);
  const { exit } = useApp();
  const { stdout } = useStdout();

  const [prefs, setPrefs] = useState<Pick<TuiConfig, "tagOrder" | "includedTagIds" | "excludedTagIds">>({
    tagOrder: config.tagOrder,
    includedTagIds: config.includedTagIds,
    excludedTagIds: config.excludedTagIds,
  });
  useEffect(() => {
    saveConfig({ apiUrl: config.apiUrl, ...prefs });
  }, [prefs, config.apiUrl]);

  // ---- data ----
  const [tasks, setTasks] = useState<TaskSummary[] | null>(null);
  const [tags, setTags] = useState<Tag[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);
  // While `editorOpen`, every useInput in the app is deactivated — ink tears down its stdin
  // listeners and raw mode — so the terminal belongs wholly to $EDITOR (nothing in Node reads
  // the shared fd). Re-enabling reattaches input through ink's normal path.
  const [editorOpen, setEditorOpen] = useState(false);
  // Tag search on the dashboard: “/” focuses the tag filter, letters type into it, Esc
  // unfocuses (matches stay visible for i/x/[/]/Enter), and Esc again collapses the list.
  const [tagSearchOn, setTagSearchOn] = useState(false);
  const [tagQuery, setTagQuery] = useState("");

  const editorOpenRef = useRef(false);
  useEffect(() => {
    editorOpenRef.current = editorOpen;
  }, [editorOpen]);

  const load = useCallback(async () => {
    if (editorOpenRef.current) return; // don't touch the terminal (or the network) while $EDITOR owns it
    try {
      const [nextTasks, nextTags] = await Promise.all([client.tasks(), client.tags()]);
      setTasks(nextTasks);
      setTags(nextTags);
      setError(null);
      // Fold any brand-new tags into the rank order so [ ] always has a neighbour to swap with.
      setPrefs((current) => {
        const known = new Set(current.tagOrder);
        const missing = nextTags.filter((tag) => !known.has(tag.id)).map((tag) => tag.id);
        return missing.length === 0 ? current : { ...current, tagOrder: [...current.tagOrder, ...missing] };
      });
    } catch (loadError) {
      setError(errorMessage(loadError));
    }
  }, [client]);

  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(), 5000);
    return () => clearInterval(interval);
  }, [load]);

  // ---- derived views (filtering mirrors DashboardPage: include = whitelist, exclude wins) ----
  const visibleTasks = useMemo(() => {
    if (!tasks) return null;
    const included = new Set(prefs.includedTagIds);
    const excluded = new Set(prefs.excludedTagIds);
    return tasks.filter((task) => {
      const taskTagIds = new Set([...task.tags, ...task.derivedTags].map((tag) => tag.id));
      if (included.size > 0 && ![...taskTagIds].some((id) => included.has(id))) return false;
      return ![...taskTagIds].some((id) => excluded.has(id));
    });
  }, [tasks, prefs.includedTagIds, prefs.excludedTagIds]);

  const rankedTags = useMemo(() => {
    if (!tags) return null;
    const byId = new Map(tags.map((tag) => [tag.id, tag]));
    const knownIds = new Set(prefs.tagOrder);
    const ranked = prefs.tagOrder.map((id) => byId.get(id)).filter((tag): tag is Tag => tag !== undefined);
    const unranked = tags.filter((tag) => !knownIds.has(tag.id)).sort((a, b) => a.title.localeCompare(b.title));
    return [...ranked, ...unranked];
  }, [tags, prefs.tagOrder]);

  // Tags are hidden by default; typing a search query reveals the matching ones (the same
  // fuzzy search the web picker uses). Empty query = no tag rows, just the header + prompt.
  const matchingTags = useMemo(
    () => (tagQuery.trim() ? matchTags(rankedTags ?? [], tagQuery, { includeArchived: true }) : []),
    [rankedTags, tagQuery],
  );

  const { rows, interactiveCount } = useMemo(() => {
    const out: Row[] = [];
    if (!visibleTasks || !rankedTags) return { rows: out, interactiveCount: 0 };
    for (const column of COLUMNS) {
      const items = visibleTasks
        .filter((task) => task.kanbanStatus === column.status)
        .sort((a, b) => b.rank - a.rank);
      out.push({ kind: "header", key: `h:${column.status}`, label: column.label, count: items.length });
      for (const task of items) out.push({ kind: "task", key: `t:${task.id}`, task });
    }
    const completed = visibleTasks
      .filter((task) => task.kanbanStatus === "completed")
      .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
    out.push({ kind: "header", key: "h:completed", label: "Completed", count: completed.length });
    for (const task of completed) out.push({ kind: "task", key: `t:${task.id}`, task });
    out.push({
      kind: "header",
      key: "h:tags",
      label: "Tags",
      count: tagQuery.trim() ? matchingTags.length : rankedTags.length,
      ...(tagQuery.trim() ? {} : { hint: "/ to search tags" }),
    });
    out.push({ kind: "tagSearch", key: "g:search" });
    for (const tag of matchingTags) out.push({ kind: "tag", key: `g:${tag.id}`, tag });
    return {
      rows: out,
      interactiveCount: out.filter((row) => row.kind !== "header" && row.kind !== "tagSearch").length,
    };
  }, [visibleTasks, rankedTags, tagQuery, matchingTags]);

  // ---- cursor over interactive rows (tasks + tags; headers are skipped) ----
  const [cursorIndex, setCursorIndex] = useState(0);
  const interactiveCountRef = useRef(interactiveCount);
  interactiveCountRef.current = interactiveCount;
  const clampedIndex = interactiveCount === 0 ? -1 : Math.min(cursorIndex, interactiveCount - 1);
  const cursorRow = useMemo(() => {
    if (clampedIndex < 0) return null;
    let seen = -1;
    for (const row of rows) {
      if (row.kind === "header" || row.kind === "tagSearch") continue;
      seen += 1;
      if (seen === clampedIndex) return row;
    }
    return null;
  }, [rows, clampedIndex]);

  const currentTask = cursorRow?.kind === "task" ? cursorRow.task : null;
  const currentTag = cursorRow?.kind === "tag" ? cursorRow.tag : null;

  // Interactive index of the first tag row matching `tagQuery` (used to snap the cursor onto
  // the best match while typing). Returns -1 when there is no match.
  function firstMatchIndex(): number {
    const first = matchingTags[0];
    if (!first) return -1;
    let seen = -1;
    for (const row of rows) {
      if (row.kind === "header" || row.kind === "tagSearch") continue;
      seen += 1;
      if (row.kind === "tag" && row.tag.id === first.id) return seen;
    }
    return -1;
  }

  // While typing a tag search, keep the cursor on the best match (unless it is already on a
  // tag that still matches).
  useEffect(() => {
    if (!tagQuery.trim()) return;
    if (currentTag && matchingTags.some((tag) => tag.id === currentTag.id)) return;
    const index = firstMatchIndex();
    if (index >= 0) setCursorIndex(index);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tagQuery]);

  function moveCursor(delta: number) {
    setCursorIndex((index) => Math.max(0, Math.min(interactiveCountRef.current - 1, index + delta)));
  }
  function moveCursorBy(page: number) {
    setCursorIndex((index) => Math.max(0, Math.min(interactiveCountRef.current - 1, index + page)));
  }

  // ---- actions (all taken from the current row; errors land in the status bar) ----
  async function guard(operation: () => Promise<void>) {
    try {
      await operation();
    } catch (actionError) {
      setError(errorMessage(actionError));
    }
  }

  function handleCreateTask(payload: NewTaskPayload): Promise<void> {
    return client.createTask({
      title: payload.title,
      kanbanStatus: "inbox",
      priority: payload.priority,
      durationMinutesRemaining: payload.durationMinutesRemaining,
      tagIds: payload.tagIds,
      ...(payload.description ? { description: payload.description } : {}),
    }).then(() => {
      setModal(null);
      return load();
    });
  }

  function handleCreateTag(title: string): Promise<void> {
    return client.createTag({ title }).then(() => {
      setModal(null);
      return load();
    });
  }

  async function suspendForEditor<T>(operation: () => Promise<T>): Promise<T> {
    setEditorOpen(true); // deactivates every useInput → ink detaches its stdin reader + raw mode
    await new Promise((resolve) => setTimeout(resolve, 40)); // let the input teardown settle
    try {
      stdout.write("\u001B[?1049l\u001B[?25h"); // leave alternate screen, show the cursor
      await new Promise((resolve) => setTimeout(resolve, 40)); // let the terminal settle
      // Node's low-level raw mode (NOT ink's setRawMode, which would also attach a reader and
      // steal the editor's keystrokes through the shared fd). Raw means the editor receives
      // every keypress immediately — no canonical buffering, so it never gets a mangled batch
      // and its startup tcflush has nothing to discard.
      process.stdin.setRawMode(true);
      await new Promise((resolve) => setTimeout(resolve, 20));
      return await operation();
    } finally {
      process.stdin.setRawMode(false);
      stdout.write("\u001B[?25l\u001B[?1049h"); // hide cursor, re-enter alternate screen
      setEditorOpen(false); // re-activates useInput → ink reattaches its stdin reader + raw mode
    }
  }

  function editTaskDescription(task: TaskSummary): Promise<void> {
    return guard(async () => {
      const edited = await suspendForEditor(() => editInEditor(task.description ?? "", `task-${task.id}-description.md`));
      if (edited !== (task.description ?? "")) {
        await client.updateTask(task.id, { description: edited });
        await load();
      }
    });
  }

  function editTagDescription(tag: Tag): Promise<void> {
    return guard(async () => {
      const edited = await suspendForEditor(() => editInEditor(tag.description ?? "", `tag-${tag.id}-description.md`));
      if (edited !== (tag.description ?? "")) {
        await client.updateTag(tag.id, { description: edited });
        await load();
      }
    });
  }

  function tagRank(tag: Tag): number {
    const index = prefs.tagOrder.indexOf(tag.id);
    return index >= 0 ? index + 1 : 0; // 0 = ".  ", unranked tags render at the end anyway
  }

  function toggleInclude(tag: Tag) {
    setPrefs((current) => {
      const has = current.includedTagIds.includes(tag.id);
      return {
        ...current,
        includedTagIds: has ? current.includedTagIds.filter((id) => id !== tag.id) : [...current.includedTagIds, tag.id],
        excludedTagIds: !has ? current.excludedTagIds.filter((id) => id !== tag.id) : current.excludedTagIds,
      };
    });
  }

  function toggleExclude(tag: Tag) {
    setPrefs((current) => {
      const has = current.excludedTagIds.includes(tag.id);
      return {
        ...current,
        excludedTagIds: has ? current.excludedTagIds.filter((id) => id !== tag.id) : [...current.excludedTagIds, tag.id],
        includedTagIds: !has ? current.includedTagIds.filter((id) => id !== tag.id) : current.includedTagIds,
      };
    });
  }

  function reorderTag(tag: Tag, direction: -1 | 1) {
    setPrefs((current) => {
      const order = [...current.tagOrder];
      const index = order.indexOf(tag.id);
      if (index < 0) return current;
      const neighbour = index + direction;
      if (neighbour < 0 || neighbour >= order.length) return current;
      const next = [...order];
      [next[index], next[neighbour]] = [next[neighbour]!, next[index]!];
      return { ...current, tagOrder: next };
    });
  }

  function moveTask(task: TaskSummary, status: KanbanStatus) {
    if (task.kanbanStatus === status) return;
    void guard(async () => {
      const destination = (visibleTasks ?? [])
        .filter((candidate) => candidate.kanbanStatus === status && candidate.id !== task.id)
        .sort((a, b) => b.rank - a.rank);
      const ordered = [...destination, task];
      await Promise.all(
        ordered.map((candidate, index) =>
          client.updateTask(candidate.id, {
            kanbanStatus: candidate.id === task.id ? status : candidate.kanbanStatus,
            rank: ordered.length - index,
          }),
        ),
      );
      await load();
    });
  }

  function reorderTask(task: TaskSummary, direction: -1 | 1) {
    void guard(async () => {
      const column = (visibleTasks ?? [])
        .filter((candidate) => candidate.kanbanStatus === task.kanbanStatus)
        .sort((a, b) => b.rank - a.rank);
      const index = column.findIndex((candidate) => candidate.id === task.id);
      if (index < 0) return;
      const neighbour = column[index + direction];
      if (!neighbour) return;
      await Promise.all([
        client.updateTask(task.id, { rank: neighbour.rank }),
        client.updateTask(neighbour.id, { rank: task.rank }),
      ]);
      await load();
    });
  }

  function toggleComplete(task: TaskSummary) {
    void guard(async () => {
      await client.updateTask(task.id, { kanbanStatus: task.kanbanStatus === "completed" ? "inbox" : "completed" });
      await load();
    });
  }

  // ---- keybindings (vim-flavored; modal/editor sessions swallow everything first) ----
  useInput(
    (input, key) => {
      if (modal !== null) return;

      if ((key.ctrl && input === "c") || input === "q") {
        exit();
        return;
      }

      // Tag search mode (“/”): letters type into the query, j/k/gg/G/page keys navigate the
      // matches. Nothing else is a command here; Esc unfocuses (keeps the matches on screen
      // for i/x/[/]/Enter) and Backspace on an empty query unfocuses too.
      if (tagSearchOn) {
        if (key.escape) {
          setTagSearchOn(false);
          return;
        }
        if (key.backspace) {
          if (tagQuery) setTagQuery((query) => query.slice(0, -1));
          else setTagSearchOn(false);
          return;
        }
        if (key.downArrow || input === "j") {
          moveCursor(1);
          return;
        }
        if (key.upArrow || input === "k") {
          moveCursor(-1);
          return;
        }
        if (input === "g") {
          moveCursor(-interactiveCountRef.current);
          return;
        }
        if (input === "G") {
          moveCursorBy(interactiveCountRef.current);
          return;
        }
        if (key.ctrl && input === "d") {
          moveCursorBy(10);
          return;
        }
        if (key.ctrl && input === "u") {
          moveCursorBy(-10);
          return;
        }
        if (input.length === 1 && input.charCodeAt(0) >= 32 && !key.ctrl && !key.meta) {
          setTagQuery((query) => query + input);
          return;
        }
        // A burst of fast typing arrives as one multi-character string — append every
        // printable character, not just the first.
        if (!key.ctrl && !key.meta) {
          let appended = "";
          for (const char of input) {
            if (char.charCodeAt(0) >= 32) appended += char;
          }
          if (appended) {
            setTagQuery((query) => query + appended);
            return;
          }
        }
        return; // swallow everything else while typing a tag search
      }

      if (input === "/") {
        setTagSearchOn(true);
        return;
      }
      if (key.escape) {
        // Esc clears an open tag search (the dashboard stays collapsed by default).
        if (tagQuery) {
          setTagQuery("");
          setTagSearchOn(false);
        }
        return;
      }
      if (input === "?") {
        setModal("help");
        return;
      }
      if (input === "r") {
        void load();
        return;
      }
      if (input === "n") {
        setModal("new-task");
        return;
      }
      if (input === "N") {
        setModal("new-tag");
        return;
      }
      if (input === "F") {
        setPrefs((current) => ({ ...current, includedTagIds: [], excludedTagIds: [] }));
        return;
      }
      if (key.downArrow || input === "j") {
        moveCursor(1);
        return;
      }
      if (key.upArrow || input === "k") {
        moveCursor(-1);
        return;
      }
      if (input === "g") {
        moveCursor(-interactiveCountRef.current);
        return;
      }
      if (input === "G") {
        moveCursorBy(interactiveCountRef.current);
        return;
      }
      if (key.ctrl && input === "d") {
        moveCursorBy(10);
        return;
      }
      if (key.ctrl && input === "u") {
        moveCursorBy(-10);
        return;
      }
      if (key.ctrl && input === "f") {
        moveCursorBy(20);
        return;
      }
      if (key.ctrl && input === "b") {
        moveCursorBy(-20);
        return;
      }

      if (currentTask) {
        if (input === "c" || input === " ") {
          toggleComplete(currentTask);
          return;
        }
        if (input >= "1" && input <= "4") {
          moveTask(currentTask, COLUMNS[Number(input) - 1]!.status);
          return;
        }
        if (input === "h" || input === "l") {
          const currentColumn = COLUMNS.findIndex((column) => column.status === currentTask.kanbanStatus);
          const next = input === "h" ? currentColumn - 1 : currentColumn + 1;
          if (next >= 0 && next < COLUMNS.length) moveTask(currentTask, COLUMNS[next]!.status);
          return;
        }
        if (input === "[") {
          reorderTask(currentTask, -1);
          return;
        }
        if (input === "]") {
          reorderTask(currentTask, 1);
          return;
        }
        if (input === "e") {
          // Enter on a tag opens its description below; e is the task equivalent.
          void editTaskDescription(currentTask);
          return;
        }
      }

      if (currentTag) {
        if (input === "i") {
          toggleInclude(currentTag);
          return;
        }
        if (input === "x") {
          toggleExclude(currentTag);
          return;
        }
        if (input === "[") {
          reorderTag(currentTag, -1);
          return;
        }
        if (input === "]") {
          reorderTag(currentTag, 1);
          return;
        }
        if (input === "e" || key.return) {
          void editTagDescription(currentTag);
          return;
        }
      }
    },
    { isActive: !editorOpen && modal === null },
  );

  // ---- header stats (mirror DashboardPage: fixed events from the calendar-event tag) ----
  const openCount = (visibleTasks ?? []).filter((task) => OPEN_KANBAN.has(task.kanbanStatus)).length;
  const fixedCount = (tasks ?? []).filter((task) =>
    [...task.tags, ...task.derivedTags].some((tag) => tag.publicId === reservedTagPublicIds.calendarEvent),
  ).length;
  const totalCount = (tasks ?? []).length;

  const includedTitles = prefs.includedTagIds
    .map((id) => tags?.find((tag) => tag.id === id)?.title)
    .filter((title): title is string => title !== undefined);
  const excludedTitles = prefs.excludedTagIds
    .map((id) => tags?.find((tag) => tag.id === id)?.title)
    .filter((title): title is string => title !== undefined);

  // ---- viewport: fit the whole app inside the terminal height ----------------
  // Ink never clips output, so the rendered tree must not exceed the screen. Task/tag rows
  // cost one line each; column headers carry a paddingTop blank so they cost two. The scroll
  // window is measured in lines, not row counts, and keeps the cursor row visible.
  const prefixLines = useMemo(() => {
    const out: number[] = [0];
    for (const row of rows) out.push(out[out.length - 1]! + (row.kind === "header" ? 2 : 1));
    return out;
  }, [rows]);

  const termHeight = stdout.rows ?? 24;
  const dataReady = tasks !== null && tags !== null;
  const chromeLines =
    2 + // title box: paddingTop blank + title text
    1 + // filter line
    (error ? 1 : 0) +
    (!dataReady ? 1 : 0) + // “Fetching…”
    (dataReady && rows.length === 0 ? 1 : 0) + // “No tasks…” hint
    3; // footer box: paddingTop blank + two prompt lines
  const cursorRowIndex = rows.findIndex((row) => row === cursorRow);

  function fitWindow(budget: number): { start: number; end: number } {
    const total = prefixLines[rows.length]!;
    if (total <= budget) return { start: 0, end: rows.length };
    if (cursorRowIndex < 0) return { start: 0, end: 0 };
    const cursorLine = prefixLines[cursorRowIndex]!;
    const idealLine = Math.max(0, Math.min(total - budget, cursorLine - Math.floor(budget / 2)));
    // the row that contains idealLine becomes the window top
    let start = Math.max(0, rows.findIndex((_, index) => prefixLines[index + 1]! > idealLine));
    const endFrom = (from: number) => {
      let remaining = budget;
      let index = from;
      while (index < rows.length && remaining >= (rows[index]!.kind === "header" ? 2 : 1)) {
        remaining -= rows[index]!.kind === "header" ? 2 : 1;
        index += 1;
      }
      return index;
    };
    let end = endFrom(start);
    // keep the cursor row fully on screen (the cursor never rests on headers)
    while (prefixLines[end]! <= cursorLine && end < rows.length) {
      start += 1;
      end = endFrom(start);
    }
    while (prefixLines[start]! > cursorLine && start > 0) {
      start -= 1;
      end = endFrom(start);
    }
    return { start, end };
  }

  // Reserve a line for the “rows above/below” indicators if the window touches an edge,
  // then re-fit with the tighter budget.
  let window = fitWindow(termHeight - chromeLines);
  if (window.start > 0 || window.end < rows.length) {
    const indicators = (window.start > 0 ? 1 : 0) + (window.end < rows.length ? 1 : 0);
    window = fitWindow(termHeight - chromeLines - indicators);
  }
  const windowStart = window.start;
  const windowedRows = rows.slice(window.start, window.end);

  return (
    <Box flexDirection="column" width="100%">
      {modal === "help" ? (
        <HelpOverlay onClose={() => setModal(null)} />
      ) : modal === "new-task" ? (
        <NewTaskModal
          tags={tags ?? []}
          onSubmit={handleCreateTask}
          onCancel={() => setModal(null)}
          editDescription={(initial) => suspendForEditor(() => editInEditor(initial, "task-description.md"))}
          editorOpen={editorOpen}
        />
      ) : modal === "new-tag" ? (
        <NewTagModal onCreate={handleCreateTag} onCancel={() => setModal(null)} />
      ) : (
        <>
          <Box paddingX={1} paddingTop={1}>
            <Text bold>Mind Palace</Text>
            <Text dimColor>  {dataReady ? `${openCount} open · ${fixedCount} fixed · ${totalCount} total` : "connecting…"} — {config.apiUrl}</Text>
          </Box>
          <Box paddingX={1}>
            <Text dimColor>Include:</Text>
            <Text color="cyan"> {includedTitles.length > 0 ? includedTitles.join(", ") : "—"}</Text>
            <Text dimColor>  Exclude:</Text>
            <Text color="red"> {excludedTitles.length > 0 ? excludedTitles.join(", ") : "—"}</Text>
            <Text dimColor>  (i/x on a tag, F clears)</Text>
          </Box>
          {error && (
            <Box paddingX={1}>
              <Text color="red">{error}</Text>
            </Box>
          )}
          {!dataReady && (
            <Box paddingX={1}>
              <Text dimColor>Fetching dashboard from {config.apiUrl}…</Text>
            </Box>
          )}
          {dataReady && windowStart > 0 && (
            <Box paddingX={1}>
              <Text dimColor>… more above</Text>
            </Box>
          )}
          {windowedRows.map((row) => (
            <Box key={row.key} paddingX={1} width="100%">
              {row.kind === "header" && <ColumnHeader label={row.label} count={row.count} {...(row.hint ? { hint: row.hint } : {})} />}
              {row.kind === "tagSearch" && <TagSearchRow query={tagQuery} focused={tagSearchOn} />}
              {row.kind === "task" && <TaskRow task={row.task} cursor={row === cursorRow} />}
              {row.kind === "tag" && (
                <TagRow
                  tag={row.tag}
                  included={prefs.includedTagIds.includes(row.tag.id)}
                  excluded={prefs.excludedTagIds.includes(row.tag.id)}
                  rank={tagRank(row.tag)}
                  cursor={row === cursorRow}
                />
              )}
            </Box>
          ))}
          {dataReady && window.end < rows.length && (
            <Box paddingX={1}>
              <Text dimColor>… {rows.length - window.end} rows below</Text>
            </Box>
          )}
          {dataReady && rows.length === 0 && (
            <Box paddingX={1}>
              <Text dimColor>No tasks or tags yet — n creates a task, N creates a tag.</Text>
            </Box>
          )}
          <Box paddingX={1} paddingTop={1} flexDirection="column">
            <Text dimColor wrap="truncate">j/k move · gg/G ends · ctrl-d/u page · 1-4 or h/l column moves · c/space complete · [ ] reorder · e/Enter edit with {editorName}</Text>
            <Text dimColor wrap="truncate">n new task · N new tag · / search tags · i/x tag filters · F clear filters · r reload · ? help · q quit</Text>
          </Box>
        </>
      )}
    </Box>
  );
}