# Daily briefing (print)

A one-page, print-first view of Mind Palace: today's weather graph, today's schedule, the tasks that
deserve attention today, the week ahead, and the board. It is a **read-only medium** — the same facts
the web app shows, laid out for paper instead of a screen.

Nothing here calls an external API. Every fact comes from the local database (the weather cache, the
stored schedule, the task rows), so a print works offline and always describes the same day.

## Shape

```
GET /api/briefing?date=YYYY-MM-DD&paper=letter          -> application/pdf
GET /api/briefing?date=YYYY-MM-DD&format=html           -> the same page as HTML (design/debug)
GET /api/briefing/payload?date=YYYY-MM-DD               -> the payload behind it (debug, other media)
```

| Piece | File | Job |
|---|---|---|
| Payload builder | `apps/server/src/services/briefing-service.ts` | Reads repositories, normalizes to local labels + minutes-since-midnight, emits `BriefingPayload`. Also the only place that decides *which* tasks count as "today's". |
| Contract | `packages/shared/src/index.ts` (`Briefing*`) | The seam between the two halves. |
| Renderer | `workers/briefing/render_briefing.py` | Pure function: payload + paper → HTML/PDF. No SQL, no network, no clock. |
| Route | `apps/server/src/http/app.ts` (`/api/briefing`) | Validation + content type. |

The renderer is a **process-boundary worker** in the same style as `workers/cp-sat/scheduler.py`:
JSON on stdin, JSON on stdout, `{"error": ...}` and a non-zero exit on failure. It is invoked through
the existing `runPythonWorker`, so there is no new process plumbing.

## Why the payload is split into `facts` and `layout`

`facts` is *what is true* (server-owned, already localized: "7:30 AM", minutes since local midnight,
"due Wed"). `layout` is *what appears on the page, in what order*:

```ts
layout: [
  { kind: "weather-day-graph" },
  { kind: "today-schedule" },
  { kind: "today-tasks", descriptionChars: 220 },
  { kind: "week-ahead", days: 7, linesPerDay: 5 },
  { kind: "board-snapshot", perColumn: 6 },
]
```

That split is the whole scalability story, and it costs nothing today:

- **A new medium** (receipt roll, e-ink panel, a future screen) is a new `PAPER` preset in the
  renderer plus a different `layout` list — not a fork. Sections lay out in percentages and ems, so
  they do not care about the page size. `?format=html` already exists for the screen case.
- **A new module** (recommended workout, AI summary, sleep, a different task list) is one new `kind`
  in `BriefingSection`, one builder in `BriefingService`, one `section_*()` function in the renderer,
  and one line in the layout. Nothing else changes. This is exactly "one module per concept, no
  framework" — there is no template engine, no plugin registry, no section base class.

There is deliberately **no** generic templating layer, no theme system, and no config file: the
layout array and the dict of render functions are the extension points, and they are plain data and
plain functions.

## Page design

Top to bottom, one letter page (0.36in margins, 8.2pt):

1. **Masthead** — date, weekday, print time, time zone.
2. **Summary strip** — weather, rain, scheduled hours, tasks on deck, ready count. The "what is today"
   answer in one glance.
3. **Weather** — a full-width graph: temperature curve over the day, precipitation probability bars,
   night shading, hour axis, plus high/low/peak-rain/daylight/wind stats and the day's conditions in
   words. Bars have a 2pt floor so a 3% hour is visible rather than absent.
4. **Today** — a ribbon timeline spanning 6am to midnight, then the agenda split into two columns
   (down the left, then down the right) so a 10-block day costs half the height. The ribbon and the
   agenda are the same data: the bar is the list, read left to right.
   - Bars are shaded in three greys — **calendar** (fixed commitment, darkest), **routine** (the
     shape of the day, lightest), **other** (everything in between) — because the printer is black
     and white. A legend sits under the ribbon so the shades are never guesswork.
   - Overlapping blocks stack into **lanes** instead of covering each other. Google Calendar solves
     this on a vertical time axis by putting events side by side; with time running left to right
     here, "side by side" is vertical, so a double-booked hour grows the ribbon rather than hiding
     work under other work.
   - Lanes are **per conflict cluster, and blocks expand into free lanes**. A day-wide lane count
     would pin an uncontested 8-hour work block to a third of the ribbon just because two blocks
     conflict at noon. Conflicts are transitive, so conflicting blocks form clusters; each cluster is
     packed on its own, and inside a cluster a block grows into every adjacent lane free for its
     whole span. A long block that merely brushes a conflict at one end keeps the rest of its height.
5. **Do today** — full-width cards, two columns, with priority pill, remaining time, tags, due label,
   and the Markdown-flattened description clipped to ~220 chars. Which tasks appear here is a server
   decision: anything with a block today, anything pinned by weekday tag, anything in progress; then
   one row per distinct title (recurrence leaves `[LIFE] Sleep` x7, which reads as a stutter).
6. **The week ahead** — 7 columns: weekday, date, high/low/rain, a 5pt day-density strip drawn from
   the same block data as the big ribbon, the first few blocks as lines, "+N more".
7. **Needs attention** — deadlines landing in the window, plus one rolled-up line for past-due work
   (per-task "overdue" labels would stamp half the page).
8. **Board** — Inbox / Ready / In progress / Waiting, top N each, with the total in the header and
   "+N more" in the footer.

Sections are ~30 lines of Python each and named `section_<kind>()`.

## Known limits

- Two pages is the fallback when the layout is too dense for one. Every section is
  `break-inside: avoid`, so a page break lands between sections rather than through a table.
- The activity ribbon clamps blocks that cross midnight (last night's sleep starts at 12:00 AM on
  today's page) so the printed times match what a person would read off the page.
- `PAPER` has `letter` and `a4` today. They are identical except for the page size on purpose: adding
  a real medium is the work of adding one preset, not guessing now what a receipt needs.
