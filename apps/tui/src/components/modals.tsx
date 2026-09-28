import { useState } from "react";
import type { Tag } from "@mind-palace/shared";
import { Box, Text, useInput, useStdout } from "ink";
import { matchTags } from "../fuzzy";

/**
 * Modal screens for the TUI. Each modal owns exactly one `useInput` handler so keystrokes
 * never leak into the dashboard's global handler (which is gated on `modal === null`).
 *
 * `NewTaskModal` is a small form: title → priority → duration → tags. The tags field is a
 * search-as-you-type picker mirroring the web UI's `TagPicker` (same fuzzy scoring, already-
 * selected and archived tags hidden). Press `d` in the priority field, or in the tags field
 * while the search is empty, to write the description with $EDITOR/neovim (the modal suspends
 * the TUI while the editor runs).
 */

const EDITOR_HINT = "d: edit description with neovim";

export interface NewTaskPayload {
  title: string;
  priority: number;
  durationMinutesRemaining: number | null;
  description: string | null;
  tagIds: number[];
}

type Field = "title" | "priority" | "duration" | "tags";

function printableCharacter(input: string, key: { ctrl: boolean; meta: boolean }): boolean {
  return input.length === 1 && input.charCodeAt(0) >= 32 && !key.ctrl && !key.meta;
}

/**
 * Ink delivers a burst of fast typing (or a paste without bracketed-paste markers) as one
 * multi-character `input` string. Run `action` for every printable character in it; ctrl/meta
 * mark control keys (arrows, Ctrl-c, …) and are never split.
 */
function forEachPrintableChar(
  input: string,
  key: { ctrl: boolean; meta: boolean },
  action: (char: string) => void,
): void {
  if (key.ctrl || key.meta) return;
  for (const char of input) {
    if (char.charCodeAt(0) >= 32) action(char);
  }
}

export function NewTaskModal({ tags, onSubmit, onCancel, editDescription, editorOpen }: {
  tags: Tag[];
  onSubmit: (payload: NewTaskPayload) => Promise<void>;
  onCancel: () => void;
  editDescription: (initial: string) => Promise<string>;
  editorOpen: boolean;
}) {
  const { stdout } = useStdout();
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState(0);
  const [durationText, setDurationText] = useState("");
  const [description, setDescription] = useState<string | null>(null);
  const [selectedTagIds, setSelectedTagIds] = useState<Set<number>>(new Set());
  const [field, setField] = useState<Field>("title");
  const [tagCursor, setTagCursor] = useState(0);
  const [tagQuery, setTagQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const durationMinutes = durationText.trim() === "" ? null : Number(durationText);
  const descriptionPreview = description === null ? null : description.split("\n")[0]?.trim() || "(empty)";

  // Fuzzy tag search, same as the web picker: type to make tags appear, already-selected and
  // archived tags are hidden, best match first.
  const matches = matchTags(tags, tagQuery, { excludeIds: selectedTagIds });
  const cursorTag = matches.length > 0 ? matches[Math.min(tagCursor, matches.length - 1)]! : null;
  const selectedTitles = tags.filter((tag) => selectedTagIds.has(tag.id)).map((tag) => tag.title);
  const chipsLine = selectedTitles.length > 0 ? 1 : 0;

  // Keep the modal inside the pane: 11 fixed lines (border, title, fields, footer), a chips
  // line when tags are selected, and a “… more” slot when the list is clipped (the render
  // window below handles the reservation).
  const tagRows = Math.max(0, (stdout.rows ?? 24) - 11 - chipsLine - (error ? 1 : 0) - (busy ? 1 : 0));

  useInput(
    (input, key) => {
      if (busy) return;

      if (key.escape) {
        // Esc in the tags search clears the query first; a second Esc cancels the modal.
        if (field === "tags" && tagQuery) {
          setTagQuery("");
        } else {
          onCancel();
        }
        return;
      }
      if (input === "d" && field === "priority") {
        void openDescription();
        return;
      }

      if (field === "title" || field === "duration") {
        if (key.tab) {
          setField(field === "title" ? "priority" : "tags");
          return;
        }
        if (key.return) {
          setField(field === "title" ? "priority" : "tags");
          return;
        }
        if (key.backspace) {
          if (field === "title") setTitle((value) => value.slice(0, -1));
          else setDurationText((value) => value.slice(0, -1));
          return;
        }
        if (printableCharacter(input, key)) {
          if (field === "title") setTitle((value) => value + input);
          else if (/^\d$/.test(input)) setDurationText((value) => (value + input).slice(0, 4));
          return;
        }
        forEachPrintableChar(input, key, (char) => {
          if (field === "title") setTitle((value) => value + char);
          else if (/^\d$/.test(char)) setDurationText((value) => (value + char).slice(0, 4));
        });
        return;
      }

      if (field === "priority") {
        if (key.tab || key.return) {
          setField("duration");
          return;
        }
        if (key.leftArrow) {
          setPriority((value) => Math.max(0, value - 1));
          return;
        }
        if (key.rightArrow) {
          setPriority((value) => Math.min(4, value + 1));
          return;
        }
        if (/^[0-4]$/.test(input)) {
          setPriority(Number(input));
          return;
        }
        forEachPrintableChar(input, key, (char) => {
          if (/^[0-4]$/.test(char)) setPriority(Number(char));
        });
        return;
      }

      // field === "tags" — type to search (fuzzy, like the web picker), ↑/↓/j/k through the
      // matches, space toggles the highlighted one, Enter saves the task.
      if (key.tab) {
        setField("title");
        return;
      }
      if (key.upArrow || input === "k") {
        if (matches.length > 0) setTagCursor((index) => Math.max(0, index - 1));
        return;
      }
      if (key.downArrow || input === "j") {
        if (matches.length > 0) setTagCursor((index) => Math.min(matches.length - 1, index + 1));
        return;
      }
      if (key.backspace) {
        setTagQuery((query) => query.slice(0, -1));
        return;
      }
      // `d` starts the description editor only when the search is empty — with a query on the
      // line it is just another search letter.
      if (input === "d" && tagQuery === "") {
        void openDescription();
        return;
      }
      if (input === " ") {
        if (cursorTag) {
          setSelectedTagIds((current) => {
            const next = new Set(current);
            if (next.has(cursorTag.id)) next.delete(cursorTag.id);
            else next.add(cursorTag.id);
            return next;
          });
        }
        return;
      }
      if (printableCharacter(input, key)) {
        setTagQuery((query) => (query + input).slice(0, 80));
        return;
      }
      forEachPrintableChar(input, key, (char) => {
        if (char === " ") {
          if (cursorTag && !selectedTagIds.has(cursorTag.id)) {
            setSelectedTagIds((current) => new Set(current).add(cursorTag.id));
          } else if (cursorTag) {
            setSelectedTagIds((current) => {
              const next = new Set(current);
              next.delete(cursorTag.id);
              return next;
            });
          }
        } else {
          setTagQuery((query) => (query + char).slice(0, 80));
        }
      });
      if (key.return) {
        void (async () => {
          if (!title.trim()) {
            setError("Title is required");
            return;
          }
          setBusy(true);
          try {
            await onSubmit({
              title: title.trim(),
              priority,
              durationMinutesRemaining: durationMinutes,
              description,
              tagIds: [...selectedTagIds],
            });
          } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : String(submitError));
            setBusy(false);
          }
        })();
        return;
      }
    },
    { isActive: !editorOpen && !busy },
  );

  const descriptionLine = descriptionPreview
    ? `Description: ${descriptionPreview} (${EDITOR_HINT.slice(2)})`
    : `Description: none — ${EDITOR_HINT}`;

  function openDescription(): Promise<void> {
    return (async () => {
      try {
        const edited = await editDescription(description ?? "");
        setDescription(edited === "" ? null : edited);
      } catch (editorError) {
        setError(editorError instanceof Error ? editorError.message : String(editorError));
      }
    })();
  }

  const activeCursorNote = field === "tags"
    ? ` · ${tagQuery.length > 0 ? "↑/↓ move · space toggle" : "type to search tags"}`
    : "";

  return (
    <Box borderStyle="round" borderColor="cyan" flexDirection="column" width={80}>
      <Box paddingX={1} paddingTop={1}>
        <Text bold>New task</Text>
      </Box>

      <Box paddingX={1}>
        <Text bold color="cyan">Title</Text>
        <Text>  {title}</Text>
        {field === "title" && <Text dimColor>█</Text>}
      </Box>

      <Box paddingX={1}>
        <Text bold color="cyan">Priority</Text>
        <Text>  P{priority}</Text>
        <Text dimColor>  (0-4, ←/→ or type a digit)</Text>
      </Box>

      <Box paddingX={1}>
        <Text bold color="cyan">Duration</Text>
        <Text>  {durationText || "—"}</Text>
        {field === "duration" && <Text dimColor>█</Text>}
        <Text dimColor>  minutes, empty = no estimate</Text>
      </Box>

      <Box paddingX={1}>
        <Text wrap="truncate">{descriptionLine}</Text>
      </Box>

      <Box flexDirection="column" paddingX={1}>
        <Box>
          <Text bold color="cyan">Tags</Text>
          <Text dimColor wrap="truncate">  search: {tagQuery}{field === "tags" ? "█" : ""}</Text>
          <Text dimColor>{activeCursorNote}</Text>
        </Box>
        {chipsLine > 0 && (
          <Text dimColor wrap="truncate">
            selected: {selectedTitles.join(", ")}
          </Text>
        )}
        {(() => {
          // Center the dropdown window on the cursor; free a line for the “… more” slot if
          // the match list is clipped.
          let visible = tagRows;
          let windowStart = Math.max(0, Math.min(tagCursor - Math.floor((visible - 1) / 2), Math.max(0, matches.length - visible)));
          let windowEnd = Math.min(matches.length, windowStart + visible);
          let hidden = matches.length - (windowEnd - windowStart);
          if (hidden > 0 && visible >= 1) {
            visible -= 1;
            windowStart = Math.max(0, Math.min(tagCursor - Math.floor((visible - 1) / 2), Math.max(0, matches.length - visible)));
            windowEnd = Math.min(matches.length, windowStart + visible);
            hidden = matches.length - (windowEnd - windowStart);
          }
          const rows = [];
          for (let index = windowStart; index < windowEnd; index += 1) {
            const tag = matches[index]!;
            rows.push(
              <Text key={tag.id} inverse={field === "tags" && tagCursor === index} wrap="truncate">
                {selectedTagIds.has(tag.id) ? "  [x]" : "  [ ]"} {tag.title}
              </Text>,
            );
          }
          if (hidden > 0) {
            rows.push(<Text key="more" dimColor>  … {hidden} more tags</Text>);
          } else if (matches.length === 0 && tagQuery.trim() !== "" && tagRows >= 1) {
            rows.push(<Text key="none" dimColor>  no matching tags</Text>);
          }
          return rows;
        })()}
      </Box>

      <Box paddingX={1} paddingTop={1}>
        <Text dimColor wrap="truncate">Enter = save · Tab = next field · Esc = clear search, then cancel</Text>
      </Box>
      {error && (
        <Box paddingX={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}
      {busy && (
        <Box paddingX={1}>
          <Text dimColor>Creating…</Text>
        </Box>
      )}
    </Box>
  );
}

export function NewTagModal({ onCreate, onCancel }: {
  onCreate: (title: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useInput(
    (input, key) => {
      if (busy) return;
      if (key.escape) {
        onCancel();
        return;
      }
      if (key.return) {
        if (!title.trim()) return;
        setBusy(true);
        void (async () => {
          try {
            await onCreate(title.trim());
          } catch (createError) {
            setError(createError instanceof Error ? createError.message : String(createError));
            setBusy(false);
          }
        })();
        return;
      }
      if (key.backspace) {
        setTitle((value) => value.slice(0, -1));
        return;
      }
      forEachPrintableChar(input, key, (char) => setTitle((value) => (value + char).slice(0, 80)));
    },
    { isActive: !busy },
  );

  return (
    <Box borderStyle="round" borderColor="cyan" flexDirection="column" width={60}>
      <Box paddingX={1} paddingTop={1}>
        <Text bold>New tag</Text>
      </Box>
      <Box paddingX={1}>
        <Text bold color="cyan">Title</Text>
        <Text>  {title}</Text>
        <Text dimColor>█</Text>
      </Box>
      {error && (
        <Box paddingX={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}
      <Box paddingX={1} paddingTop={1} paddingBottom={1}>
        <Text dimColor>Enter = create · Esc = cancel</Text>
      </Box>
    </Box>
  );
}

export function HelpOverlay({ onClose }: { onClose: () => void }) {
  const { stdout } = useStdout();
  useInput(
    (input, key) => {
      if (key.escape || input === "q" || input === "?") onClose();
    },
    { isActive: true },
  );

  const helpLines = [
    ["Navigation", "j/k or ↓/↑ move · gg first · G last · Ctrl-d/u half page · Ctrl-f/b full page"],
    ["Tasks", "1-4 move to Inbox/Ready/In progress/Waiting · h/l step columns · c/space toggle complete"],
    ["Tasks", "[ ] reorder within column · e edit description with neovim"],
    ["Tags", "/ search tags (type to filter, j/k move, Esc to stop) · i / x include / exclude · [ ] reorder rank (persisted) · Enter edit description with neovim"],
    ["General", "n new task · N new tag · F clear filters · r reload · ? help · q / Ctrl-c quit"],
  ];
  // border(2) + title(2) + pad blank(1) + hint(2) = 7 fixed lines; clip help rows in short panes.
  const maxHelpRows = Math.max(1, (stdout.rows ?? 24) - 7);

  return (
    <Box borderStyle="round" borderColor="cyan" flexDirection="column" width={76}>
      <Box paddingX={1} paddingTop={1}>
        <Text bold color="cyan">Mind Palace TUI keys</Text>
      </Box>
      {helpLines.slice(0, maxHelpRows).map(([group, description]) => (
        <Box key={`${group}-${description}`} paddingX={1}>
          <Text bold color="yellow">{group}:</Text>
          <Text dimColor wrap="truncate"> {description}</Text>
        </Box>
      ))}
      <Box paddingBottom={1} />
      <Box paddingX={1} paddingBottom={1}>
        <Text dimColor wrap="truncate">Rank order and tag filters live in ~/.config/mind-palace/tui.json (override with MP_TUI_CONFIG).</Text>
      </Box>
    </Box>
  );
}