# Mind Palace TUI

A full-screen terminal dashboard for Mind Palace, built for a tmux pane. Same data flow as
the web app: it reads/writes through the Hono HTTP API (never the database), and imports the
shared contracts from `@mind-palace/shared`.

## Run

```sh
pnpm dev                      # start the server + web app (or just the server: pnpm --filter @mind-palace/server dev)
pnpm --filter @mind-palace/tui dev    # the TUI, in a tmux pane with room to breathe
```

The dashboard resizes to its pane: it fills the terminal height exactly (short panes get a
scrolling viewport with “more above/below” markers; tall panes show everything). Resize the
pane and it reflows automatically.

- `MP_API_URL` — server base URL (default `http://127.0.0.1:4310`)
- `MP_TUI_CONFIG` — config file path (default `~/.config/mind-palace/tui.json`)
- `VISUAL`/`EDITOR` — editor used for descriptions (default `nvim`)

## Keys (vim-flavored)

| Keys | Action |
| --- | --- |
| `j`/`k` or `↓`/`↑` | move cursor |
| `gg` / `G` | first / last row |
| `Ctrl-d`/`Ctrl-u` | half page down/up |
| `Ctrl-f`/`Ctrl-b` | page down/up |
| `1`–`4` or `h`/`l` | move selected task to Inbox/Ready/In progress/Waiting |
| `c` / `Space` | toggle selected task complete |
| `[` / `]` | reorder selected task within its column / reorder tag rank |
| `e` | edit selected task description in `$EDITOR` |
| `Enter` | edit selected tag description in `$EDITOR` |
| `i` / `x` | include / exclude selected tag from the filter |
| `F` | clear all tag filters |
| `n` / `N` | new task / new tag |
| `r` | reload now (polling runs every 5s) |
| `?` | help |
| `q` / `Ctrl-C` | quit |

Task columns show Inbox / Ready / In progress / Waiting (then Completed, then the tag list),
exactly like the web dashboard — include acts as a whitelist, exclude wins over include.

## Tag search (same as the web picker)

Tags are **hidden by default** — no wall of ~25 tags. Press `/` and type to search; matching
tags appear immediately using the same fuzzy scoring as the web UI's `TagPicker` (exact /
prefix / substring / subsequence, best match first). `j`/`k` move over the matches while
typing, `Esc` stops searching (matches stay for `i`/`x`/`Enter`), and `Esc` again collapses
the list. The new-task modal's tag field works the same way: type to find, space toggles,
already-selected and archived tags are hidden.

## Rank order (tags)

Tags have no rank column in the database (the API sorts them by title). The TUI keeps a local
display order in `tui.json` (`tagOrder`, in `MP_TUI_CONFIG`), edited with `[`/`]` on a tag row.
New tags are appended to the order automatically. Task ordering within a column *is* real:
`[`/`]` swaps `rank` through `PATCH /api/tasks/:id`, same as drag-and-drop on the web.

## Editing descriptions

`Enter` on a tag / `e` on a task writes the current description to a temp file, suspends the
TUI's alternate screen, and opens `$VISUAL`/`$EDITOR` (default `nvim`). While the editor runs
the TUI hands over the whole terminal: its stdin reader is detached and the tty stays in raw
mode, so every keystroke goes to the editor (nothing in Node reads the shared fd). Save-and-
quit writes the description back through the API; `q!` leaves it untouched. New tasks can
take a description too: press `d` inside the new-task modal (in the tags field, `d` is a
search letter once the query is non-empty).
