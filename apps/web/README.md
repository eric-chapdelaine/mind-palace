# Web

The React application provides three product surfaces:

- `/`: work/personal/all filters, five-column kanban, cross-column and within-column dragging, fuzzy tag selection and creation, a completed-task disclosure ordered by completion time, a collapsible tag hierarchy, and quick task capture with an optional estimate.
- `/tasks/:id`: editable task planning details and tags, Markdown description rendering, time blocks, per-task schedule acceptance, and OpenCode sections only for `llm_eligible` tasks. State history uses a collapsed native details element.
- `/schedule`: a Google Calendar-style seven-day hourly grid beginning today, previous/today/next navigation, Boston weather context, fixed and planned blocks, elapsed-time muting, CP-SAT generation, acceptance, and unscheduled tasks.

The interface polls the local API because v0 does not need a realtime transport. Agent controls appear only when a task has the `llm_eligible` tag, and dispatch always requires an explicit button click.

Kanban drag-and-drop changes status when crossing columns and changes rank when dropping on another card. The board sorts by rank; priority remains the scheduler's primary ordering input.

Styling intentionally stays close to native HTML: system fonts, neutral borders, normal-sized headings, and minimal color. Cards retain a small hover lift for affordance.

Run only the web app with:

```sh
pnpm --filter @opencode-task-manager/web dev
```

The development server runs on port `4311` and proxies `/api` to port `4310`.
