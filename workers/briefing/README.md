# Daily briefing (print)

A one-page, print-first view of Mind Palace: today's weather graph, today's schedule, the tasks that
deserve attention today, and the week ahead. It is a **read-only medium** — the same facts the web
app shows, laid out for paper instead of a screen.

The board snapshot and the needs-attention list are built and renderable but **not printed by
default** (see the layout note below): on a full week they are what tips the page onto a second
sheet, and a two-page briefing is no longer a glance.

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
  { kind: "week-ahead", days: 7, linesPerDay: 5, attention: false },
]
```

`board-snapshot` is a supported `kind` and has a working renderer; it is simply absent from the
default list until the day the page can afford it. Re-enabling it, or the attention list
(`attention: true` on `week-ahead`), is a one-line change to `DEFAULT_LAYOUT` — or a `layout` passed
in a single request — rather than a reimplementation.

The board also excludes calendar events (`mind-palace:calendar-event`). An imported event is a fixed
commitment, already shown on the timeline and in the week ahead; as a card it reads as work to do.

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
4. **Today** — a **vertical day calendar**, like Google Calendar: time runs down the page and a box's
   height is its duration. The ribbon-plus-agenda pair is gone. The calendar carries the time, name,
   length and kind of every block itself, so there is no second table to keep in sync and nothing
   read twice.
   - The window **hugs the day's content** within the 6am–midnight bounds, rounded out to whole hours
     and never narrower than six hours. A fixed 6am–midnight window spends most of its height on
     empty hours: over 18 hours a 30-minute block is 5.4pt tall and one line of tiny text needs
     7.8pt, so a short block printed as an unlabelled sliver. Narrowing the window is what makes the
     resolution available for short blocks to say anything at all.
   - Two numbers set the worst case, `paper['day']` (height) and `paper['calfont']` (block type size):
     the drawable window is roughly `day * 72 / (calfont * callead)`, i.e. how many hours of axis fit
     before a 30-minute block loses its title. At 3.30in and 5.0pt that is ~19 hours, so even a full
     6am–midnight day labels a 30-minute block, and a 15-minute block labels itself in any window
     narrower than ~9.5 hours. Measured: an 18-hour day packed with thirty-four consecutive 30-minute
     blocks still prints all thirty-four titles on one page.
   - Consequence: the vertical scale differs from day to day. A 9am–7pm day gives every block ~20%
     more height than a 6am–midnight day would.
   - Boxes are shaded in three greys — **calendar** (fixed commitment, darkest), **routine** (the
     shape of the day, lightest), **other** (everything in between) — because the printer is black
     and white. Label ink flips with the shade, and a legend sits under the calendar.
   - Overlapping blocks are **columns**, exactly as Google Calendar draws double-booked events.
     Columns are per conflict cluster: a day-wide count would squeeze an uncontested 4-hour work
     block into a third of the width because two unrelated blocks collide at noon. Conflicts are
     transitive, so conflicting blocks form clusters; each cluster is packed on its own, and inside a
     cluster a block expands into every adjacent column free for its whole span.
   - Height decides how much a box reports. Two or more lines gets name, `start–end · length · kind`;
     one line gets `name · 12:30p-1:30p` inline, because an hour of an 18-hour day is about one line
     and a calendar where most blocks never say when they are is not a calendar. Under one line of
     room, no text: the shade and position carry it.
   - The vertical window is `paper['day']` (3.30in on letter). That number is a real constraint and
     it is tight: it trades directly against the sections below it. 2.40in was not enough to label a
     30-minute block on a long day; the extra height is paid for by dropping the board and the
     attention list from the default layout (see above). Re-check page count after changing it.
5. **Do today** — full-width cards, two columns, with priority pill, remaining time, tags, due label,
   and the Markdown-flattened description clipped to ~220 chars. Which tasks appear here is a server
   decision: anything with a block today, anything pinned by weekday tag, anything in progress; then
   one row per distinct title (recurrence leaves `[LIFE] Sleep` x7, which reads as a stutter).
6. **The week ahead** — 7 columns: weekday, date, high/low/rain, a 5pt day-density strip drawn from
   the same block data as the big ribbon, the first few blocks as lines, "+N more".
7. **Needs attention** — *not printed by default.* Deadlines landing in the window, plus one
   rolled-up line for past-due work (per-task "overdue" labels would stamp half the page). Renders
   inside the week section; turn it on with `{ kind: "week-ahead", attention: true }`.
8. **Board** — *not printed by default.* Inbox / Ready / In progress / Waiting, top N each, with the
   total in the header and "+N more" in the footer. Calendar events are excluded (see above).

Sections are ~30 lines of Python each and named `section_<kind>()`.

## Printing

The server only ever returns the PDF; it does not talk to a printer. Download it on the computer
that has the printer, and print it there:

```sh
curl -s http://rpi:4310/api/briefing -o today.pdf
lp today.pdf                      # or open it and print from a viewer
```

`date=YYYY-MM-DD` picks the day, so printing tomorrow's page at the end of today is the same call
with tomorrow's date; `paper=a4` switches page size. Nothing else is needed — no `lp` on the Pi, no
CUPS queue there, no extra script.

There is deliberately no print endpoint. Having the server call `lp` would mean the paper is next to
the server, which is not the setup: the printer is next to the person asking for the page. If that
ever changes (an unattended nightly print, say), the shape is a `curl` in a cron entry on the machine
with the printer, or a third entry in `apps/server/src/jobs.ts` calling `lp` on a server that has a
queue. Neither needs anything in this worker.

## Known limits

- Two pages is the fallback when the layout is too dense for one. Ordinary sections may break across
  the fold (`break-inside: auto`, so a half-empty page 1 does not push everything down); the week and
  the board are pinned, because splitting either one leaves unreadable half-columns.
- Blocks that cross midnight are clamped (last night's sleep starts at 12:00 AM on today's page) so
  the printed times match what a person would read off the page.
- A timestamp that will not parse is treated as missing, not as fatal. `tasks.deadline_at` is
  free-form text written by the app and by imports, and a single malformed row used to throw
  `RangeError: Invalid time value` out of `Intl.DateTimeFormat` and fail the whole page with an HTTP
  400 — no printout at all, from one bad deadline. A task with an unreadable deadline now simply has
  no deadline as far as the print is concerned.
- A very heavy week (seven days of six blocks each, plus several deadlines) still runs to two pages,
  and the overflow is the board, not the calendar. That is the one case where `perColumn` matters:
  at that density `perColumn: 3` also fits on one page. The fuller default of 6 is kept because a
  board that shows three of fifty-two ready tasks is less useful than one extra board-only page on a
  day that dense.
- A malformed date is rejected rather than rolled over. `\d{4}-\d{2}-\d{2}` accepts `2026-02-31`, and
  `Date` silently turns that into March 3, so the shape check is backed by a round-trip through UTC.
- `PAPER` has `letter` and `a4` today. They are identical except for the page size on purpose: adding
  a real medium is the work of adding one preset, not guessing now what a receipt needs.
