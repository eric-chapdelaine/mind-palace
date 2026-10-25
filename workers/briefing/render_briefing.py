#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["weasyprint>=62"]
# ///
"""Render a Mind Palace daily briefing payload to a PDF.

Protocol (same shape as `workers/cp-sat/scheduler.py` and `workers/garmin/sync.py`): one JSON
object on stdin, one JSON object on stdout, `{"error": "..."}` + a non-zero exit on failure.

Requests:

    {"payload": <BriefingPayload>, "paper": "letter", "action": "render"}          -> {"pdfBase64": ...}
    {"payload": <BriefingPayload>, "paper": "letter", "action": "write", "outPath": ...} -> {"pdfPath": ...}
    {"payload": <BriefingPayload>, "paper": "letter", "action": "html"}             -> {"html": ...}

`html` exists so the design can be iterated on without paying for a PDF render, and so a screen
medium can reuse the same markup with a different stylesheet.

The worker is a pure function of the payload. It never reads the database, the network, or the wall
clock, and it renders only the sections listed in `payload.layout` (so "the receipt version" is a
different list, not a different code path).

File layout == design layout:

    PAPER / css()          page geometry and the whole visual language, one preset per medium
    build_html()           the shell: masthead, summary strip, then one renderer per layout entry
    section_<kind>()       one function per section kind, ~30 lines each
    main()                 the stdin/stdout protocol
"""

from __future__ import annotations

import base64
import json
import re
import sys
from html import escape
from typing import Any, Callable

# ---------------------------------------------------------------------------------------------
# Paper presets
# ---------------------------------------------------------------------------------------------
#
# A "paper" is geometry plus the few type sizes that depend on it. Adding a medium (receipt roll,
# e-ink panel) means adding a preset; section renderers are size-agnostic because they lay out in
# percentages and ems. `letter` is the real target today.

PAPER: dict[str, dict[str, str]] = {
    "letter": {
        "size": "letter",
        "margin": "0.36in",
        "base": "8.2pt",
        "lead": "1.22",
        "h2": "8.4pt",
        "small": "6.8pt",
        "tiny": "6.0pt",
        "graph": "1.0in",
        "ribbon": "0.30in",
    },
    "a4": {
        "size": "a4",
        "margin": "0.36in",
        "base": "8.2pt",
        "lead": "1.22",
        "h2": "8.4pt",
        "small": "6.8pt",
        "tiny": "6.0pt",
        "graph": "1.0in",
        "ribbon": "0.30in",
    },
}

SECTION_TITLES = {
    "weather-day-graph": "Weather",
    "today-schedule": "Today",
    "today-tasks": "Do today",
    "week-ahead": "The week ahead",
    "board-snapshot": "Board",
}

KANBAN_LABELS = {
    "inbox": "Inbox",
    "ready": "Ready",
    "in_progress": "In progress",
    "waiting": "Waiting",
}

# Ink colours. Grayscale-safe: the two hues also differ in darkness, and blocks carry a text label
# where the hue is load-bearing (proposed vs accepted).
INK = {
    "line": "#191919",
    "hair": "#c9c9c9",
    "muted": "#6d6d6d",
    "faint": "#8f8f8f",
    "accent": "#2f5d8a",   # accepted work
    "proposal": "#9aa8b6",  # proposed work (lighter, hatched in the ribbon)
    "event": "#5c5c5c",    # calendar event / fixed commitment
    "night": "#ececec",    # non-daylight background band
    "rain": "#7f9db8",
    "warn": "#8a3b2f",
}


# ---------------------------------------------------------------------------------------------
# Small pure helpers
# ---------------------------------------------------------------------------------------------

def truncate(text: str, limit: int) -> str:
    """Clip to `limit` characters on a word boundary, with an ellipsis when clipped."""
    collapsed = " ".join(text.split())
    if len(collapsed) <= limit:
        return collapsed
    cut = collapsed[:limit].rsplit(" ", 1)[0].rstrip(",.;:")
    return f"{cut}…"


_MD_PATTERNS = [
    (re.compile(r"^```.*$", re.MULTILINE), ""),            # code fence markers
    (re.compile(r"^#{1,6}\s*", re.MULTILINE), ""),         # heading markers
    (re.compile(r"!\[[^\]]*\]\([^)]*\)"), ""),              # images
    (re.compile(r"\[([^\]]+)\]\([^)]*\)"), r"\1"),          # links keep their text
    (re.compile(r"(\*\*|__)(.+?)\1"), r"\2"),               # bold
    (re.compile(r"(\*|_)(.+?)\1"), r"\2"),                  # italics
    (re.compile(r"`([^`]*)`"), r"\1"),                      # inline code
    (re.compile(r"^\s*[-*+]\s+", re.MULTILINE), ""),        # bullets
    (re.compile(r"^\s*>\s?", re.MULTILINE), ""),            # quotes
]


def plain_text(markdown: str) -> str:
    """Flatten a task description's Markdown to plain prose, keeping its line structure.

    Line breaks are preserved on purpose: a grocery list or a workout plan is *only* useful as a
    list. Whitespace inside a line collapses; blank lines collapse away.
    """
    text = markdown
    for pattern, replacement in _MD_PATTERNS:
        text = pattern.sub(replacement, text)
    lines = [" ".join(line.split()) for line in text.splitlines()]
    return "\n".join(line for line in lines if line)


def clip(text: str, chars: int, lines: int) -> tuple[str, bool]:
    """Clip to a line budget and a character budget, whichever runs out first.

    Returns (text, clipped). Line-aware because a list clipped mid-item reads as an error, while a
    paragraph clipped mid-sentence reads as "there is more".
    """
    kept = text.split("\n")[:lines]
    clipped = len(kept) < len(text.split("\n"))
    out: list[str] = []
    budget = chars
    for index, line in enumerate(kept):
        if budget <= 0:
            clipped = True
            break
        if len(line) > budget:
            out.append(truncate(line, budget) if budget > 12 else line[:budget].rstrip() + "…")
            clipped = True
            break
        out.append(line)
        budget -= len(line) + 1
        if index < len(kept) - 1 and budget <= 0:
            clipped = True
            break
    return "\n".join(out), clipped


def minutes_label(minutes: int | None) -> str:
    if not minutes:
        return ""
    hours, rest = divmod(int(minutes), 60)
    return f"{hours}h{rest:02d}" if hours else f"{rest}m"


def dur(total_minutes: float) -> str:
    """Timeline height/length label for a block duration."""
    if total_minutes >= 60:
        hours = total_minutes / 60
        return f"{hours:.1f}h".replace(".0h", "h")
    return f"{int(total_minutes)}m"


# ---------------------------------------------------------------------------------------------
# CSS
# ---------------------------------------------------------------------------------------------

def css(paper: dict[str, str]) -> str:
    return f"""
@page {{
  size: {paper['size']};
  margin: {paper['margin']} {paper['margin']} 0.42in {paper['margin']};
  @bottom-center {{
    content: "mind palace · daily briefing · " counter(page) " of " counter(pages);
    font-family: "Liberation Sans", "Noto Sans", sans-serif;
    font-size: {paper['tiny']};
    color: {INK['faint']};
    letter-spacing: 0.05em;
  }}
}}
* {{ box-sizing: border-box; }}
html {{
  font-family: "Liberation Sans", "Noto Sans", sans-serif;
  font-size: {paper['base']};
  line-height: {paper['lead']};
  color: {INK['line']};
}}
body {{ margin: 0; }}
h1, h2, h3 {{ margin: 0; font-weight: 600; }}
time, .num {{ font-variant-numeric: tabular-nums; }}
.muted {{ color: {INK['muted']}; }}
.small {{ font-size: {paper['small']}; }}
.tiny {{ font-size: {paper['tiny']}; }}

/* ---- masthead ------------------------------------------------------------------------- */
.masthead {{
  display: flex; align-items: flex-end; justify-content: space-between; gap: 10pt;
  border-bottom: 1.5pt solid {INK['line']}; padding-bottom: 2.5pt;
}}
.masthead h1 {{ font-size: 14.5pt; letter-spacing: -0.005em; white-space: nowrap; }}
.masthead h1 .weekday {{ font-weight: 400; color: #4a4a4a; }}
.masthead .stamp {{ font-size: {paper['tiny']}; color: {INK['faint']}; text-align: right; line-height: 1.35; }}
.strip {{
  display: flex; gap: 0; border-bottom: 0.5pt solid {INK['hair']}; margin-bottom: 1pt;
}}
.strip > div {{
  flex: 1 1 0; padding: 2.5pt 6pt 2.5pt 0; border-right: 0.4pt solid {INK['hair']};
}}
.strip > div:last-child {{ border-right: 0; }}
.strip > div:first-child {{ padding-left: 0; }}
.strip .k {{ font-size: {paper['tiny']}; text-transform: uppercase; letter-spacing: 0.07em; color: {INK['faint']}; }}
.strip .v {{ font-size: 9.4pt; font-weight: 600; }}

/* ---- section shell -------------------------------------------------------------------- */
/* Sections flow across the page rather than each claiming a whole one: a half-empty page is worse
   than a section that starts near the bottom. Only the pieces that must stay whole are pinned. */
section.sec {{ margin-top: 5.5pt; break-inside: auto; }}
.sec-head {{ break-after: avoid; }}
.sec-week-ahead, .sec-board-snapshot {{ break-inside: avoid; }}
.sec-head {{
  display: flex; align-items: baseline; gap: 6pt;
  border-bottom: 0.7pt solid {INK['line']}; padding-bottom: 1.2pt; margin-bottom: 3.5pt;
}}
.sec-head h2 {{ font-size: {paper['h2']}; text-transform: uppercase; letter-spacing: 0.1em; }}
.sec-head .note {{ font-size: {paper['tiny']}; color: {INK['faint']}; margin-left: auto; }}

/* ---- weather -------------------------------------------------------------------------- */
.weather {{ display: flex; gap: 9pt; }}
.weather .graph {{ flex: 1 1 auto; }}
.weather svg {{ display: block; width: 100%; height: {paper['graph']}; }}
.weather .stats {{ flex: 0 0 1.22in; font-size: {paper['small']}; }}
.weather .stats .row {{
  display: flex; justify-content: space-between; gap: 4pt;
  border-bottom: 0.3pt dotted {INK['hair']}; padding: 1.4pt 0;
}}
.weather .stats .row .k {{ color: {INK['muted']}; }}
.weather .stats .row .v {{ font-weight: 600; font-variant-numeric: tabular-nums; }}

/* ---- today: ribbon + agenda ----------------------------------------------------------- */
.ribbon {{ position: relative; height: {paper['ribbon']}; border: 0.4pt solid {INK['hair']}; background: #fbfbfb; }}
.ribbon .span {{ position: absolute; display: flex; align-items: center; border-right: 0.4pt solid #fff; border-bottom: 0.4pt solid #fff; overflow: hidden; }}
.ribbon .span span {{ font-size: {paper['tiny']}; padding: 0 1.5pt; white-space: nowrap; overflow: hidden; }}
.ribbon .tick {{ position: absolute; top: 0; bottom: 0; border-left: 0.3pt solid #e2e2e2; }}
.legend {{ display: flex; gap: 10pt; font-size: {paper['tiny']}; color: {INK['muted']}; padding: 1.5pt 0 0; }}
.legend .lg {{ display: flex; align-items: center; gap: 2.5pt; }}
.legend .sw {{ width: 7pt; height: 4.5pt; display: inline-block; border: 0.3pt solid #b0b0b0; }}
.ribbon .now {{ position: absolute; top: -2pt; bottom: -2pt; border-left: 1pt solid {INK['warn']}; }}
.axis {{ position: relative; height: 9pt; }}
.axis span {{ position: absolute; font-size: {paper['tiny']}; color: {INK['muted']}; transform: translateX(-50%); }}

.agendas {{ display: table; width: 100%; table-layout: fixed; margin-top: 3pt; }}
.agendas > div {{ display: table-cell; vertical-align: top; }}
.agendas.two > div:first-child {{ width: 52%; padding-right: 11pt; }}
.agenda {{ width: 100%; border-collapse: collapse; }}
.agenda th {{
  text-align: left; font-size: {paper['tiny']}; text-transform: uppercase; letter-spacing: 0.07em;
  color: {INK['faint']}; font-weight: 600; border-bottom: 0.4pt solid {INK['hair']}; padding: 1.5pt 3pt;
}}
.agenda td {{ padding: 1.15pt 3pt; border-bottom: 0.3pt dotted {INK['hair']}; vertical-align: baseline; }}
.agenda tr {{ break-inside: avoid; }}
.agenda td.t {{ white-space: nowrap; font-variant-numeric: tabular-nums; width: 0.92in; }}
.agenda td.d {{ white-space: nowrap; text-align: right; width: 0.4in; color: {INK['muted']}; }}
.agenda td.s {{ white-space: nowrap; width: 0.62in; font-size: {paper['tiny']}; text-transform: uppercase; letter-spacing: 0.05em; }}
.agenda .swatch {{ display: inline-block; width: 4pt; height: 4pt; margin-right: 3pt; vertical-align: middle; }}
.agenda tr.past td {{ color: #9a9a9a; }}

/* ---- today's tasks -------------------------------------------------------------------- */
.tasks {{ display: table; width: 100%; table-layout: fixed; }}
.tasks .tcol {{ display: table-cell; vertical-align: top; width: 50%; }}
.tasks.two .tcol:first-child {{ padding-right: 11pt; border-right: 0.3pt solid {INK['hair']}; }}
.tasks.two .tcol:last-child {{ padding-left: 11pt; }}
.task {{ display: flex; gap: 4.5pt; padding: 1.8pt 0; border-top: 0.3pt solid {INK['hair']};
         break-inside: avoid; }}
.task:first-child {{ border-top: 0; }}
.task .pri {{ flex: 0 0 0.2in; font-size: {paper['tiny']}; font-weight: 700; color: #fff; background: {INK['line']};
             text-align: center; height: 9pt; line-height: 9pt; border-radius: 1pt; }}
.task .pri.p-low {{ background: #b3b3b3; }}
.task .body {{ flex: 1 1 auto; min-width: 0; }}
.task .head {{ display: flex; align-items: baseline; gap: 5pt; }}
.task .head b {{ font-weight: 600; }}
.task .head .meta {{ margin-left: auto; white-space: nowrap; font-size: {paper['tiny']}; color: {INK['muted']}; }}
.task .desc {{ font-size: {paper['small']}; color: #333; padding-top: 0.4pt; }}
.task .dline {{ padding-left: 6pt; text-indent: -6pt; line-height: 1.25; }}
.task .dline::before {{ content: "· "; color: {INK['faint']}; }}
.task .dline.more {{ color: {INK['faint']}; }}
.task .dline.more::before {{ content: ""; }}
.task .tag {{ font-size: {paper['tiny']}; color: {INK['muted']}; }}
.task .tag::before {{ content: "#"; }}
.task .due {{ color: {INK['warn']}; }}

/* ---- week ahead ----------------------------------------------------------------------- */
.week {{ display: table; width: 100%; table-layout: fixed; border-collapse: collapse; break-inside: avoid; }}
.week .day {{ display: table-cell; width: 14.28%; border-left: 0.4pt solid {INK['hair']}; padding: 0 3.5pt; vertical-align: top; }}
.week .day:first-child {{ border-left: 0; padding-left: 0; }}
.week .day:last-child {{ padding-right: 0; }}
.week .day.today {{ background: #f4f4f4; }}
.week .dhead {{ border-bottom: 0.5pt solid {INK['line']}; padding-bottom: 1.5pt; margin-bottom: 2.5pt; }}
.week .dhead .wd {{ font-size: {paper['tiny']}; text-transform: uppercase; letter-spacing: 0.07em; color: {INK['muted']}; }}
.week .dhead .dn {{ font-size: 10.5pt; font-weight: 600; line-height: 1.05; }}
.week .dhead .wx {{ font-size: {paper['tiny']}; color: {INK['muted']}; }}
.week .mini {{ position: relative; height: 5pt; margin: 2pt 0 2.5pt; background: #f0f0f0; border: 0.3pt solid {INK['hair']}; }}
.week .mini .span {{ position: absolute; top: 0; bottom: 0; }}
.week .line {{ font-size: {paper['small']}; padding: 0.7pt 0; line-height: 1.15; }}
.week .line .h {{ font-variant-numeric: tabular-nums; color: {INK['muted']}; }}
.week .grp {{ font-size: {paper['tiny']}; text-transform: uppercase; letter-spacing: 0.08em;
              color: {INK['faint']}; padding-top: 2pt; }}
.week .grp.due {{ color: {INK['warn']}; }}
.week .line.due {{ color: #333; }}
.week .more {{ font-size: {paper['tiny']}; color: {INK['faint']}; padding-top: 1pt; }}
.week .empty {{ font-size: {paper['tiny']}; color: #b0b0b0; }}

/* ---- board ---------------------------------------------------------------------------- */
.board {{ display: table; width: 100%; table-layout: fixed; border-collapse: collapse; break-inside: avoid; }}
.board .col {{ display: table-cell; width: 25%; border-left: 0.4pt solid {INK['hair']}; padding: 0 5pt 0 4pt; vertical-align: top; }}
.board .col:first-child {{ border-left: 0; padding-left: 0; }}
.board .col:last-child {{ padding-right: 0; }}
.board .chead {{ display: flex; align-items: baseline; gap: 4pt; border-bottom: 0.5pt solid {INK['line']};
                 padding-bottom: 1.2pt; margin-bottom: 2.5pt; }}
.board .chead b {{ font-size: {paper['tiny']}; text-transform: uppercase; letter-spacing: 0.08em; }}
.board .chead .n {{ margin-left: auto; font-size: {paper['tiny']}; color: {INK['faint']}; }}
.board .item {{ font-size: {paper['small']}; padding: 0.95pt 0; border-top: 0.25pt dotted {INK['hair']}; line-height: 1.2; }}
.board .item:first-of-type {{ border-top: 0; }}
.board .item .m {{ color: {INK['muted']}; font-size: {paper['tiny']}; }}
.board .more {{ font-size: {paper['tiny']}; color: {INK['faint']}; padding-top: 1.5pt; }}

/* ---- attention list ------------------------------------------------------------------- */
.attention-wrap {{ margin-top: 4pt; border-top: 0.4pt solid {INK['hair']}; padding-top: 2.5pt; }}
.attention-head {{ font-size: {paper['tiny']}; text-transform: uppercase; letter-spacing: 0.08em;
                   color: {INK['faint']}; margin-bottom: 1.5pt; }}
.attention {{ margin: 0; padding: 0; list-style: none; column-count: 3; column-gap: 14pt; }}
.attention li {{ font-size: {paper['small']}; padding: 0.7pt 0 0.7pt 8pt; position: relative; break-inside: avoid; }}
.attention li::before {{ content: "▪"; position: absolute; left: 0; color: {INK['faint']}; }}
"""


# ---------------------------------------------------------------------------------------------
# Shared fragments
# ---------------------------------------------------------------------------------------------

def section_shell(kind: str, body: str, note: str = "") -> str:
    note_html = f'<span class="note">{escape(note)}</span>' if note else ""
    return (
        f'<section class="sec sec-{kind}">'
        f'<div class="sec-head"><h2>{escape(SECTION_TITLES.get(kind, kind))}</h2>{note_html}</div>'
        f"{body}</section>"
    )


def masthead(payload: dict[str, Any]) -> str:
    date_label = payload["dateLabel"]
    weekday, _, rest = date_label.partition(",")
    headline = rest.strip() or date_label
    weekday_html = f' <span class="weekday">· {escape(weekday)}</span>' if rest else ""
    return (
        '<div class="masthead">'
        f"<h1>{escape(headline)}{weekday_html}</h1>"
        f'<div class="stamp">printed {escape(payload["printedAtLabel"])}<br>{escape(payload["timeZone"])}</div>'
        "</div>"
    )


def summary_strip(payload: dict[str, Any]) -> str:
    """Five headline numbers: the answer to "what kind of day is this" in one glance."""
    facts = payload["facts"]
    day = facts.get("weatherDay") or {}
    week = facts.get("week") or []
    today = next((day_row for day_row in week if day_row.get("isToday")), None)
    cells: list[tuple[str, str]] = []
    hi, lo = day.get("highF"), day.get("lowF")
    cells.append(("Weather", f"{hi}° / {lo}°" if hi is not None and lo is not None else "—"))
    rain = day.get("rainPercent")
    cells.append(("Rain", f"{rain}% peak" if rain else "none"))
    uv = day.get("uvMax")
    if uv is None:
        uv_text = "—"
    else:
        band = uv_band(uv)
        when = day.get("uvMaxLabel")
        uv_text = f"{band} · {_strip_clock(when)}" if when else band
    cells.append(("UV", uv_text))
    sunrise, sunset = day.get("sunriseLabel"), day.get("sunsetLabel")
    span = daylight_span(day.get("sunriseMinutes"), day.get("sunsetMinutes"))
    cells.append(("Daylight", f"{_strip_clock(sunrise)}–{_strip_clock(sunset)}{f' · {span}' if span else ''}" if sunrise and sunset else "—"))
    if today is not None:
        blocks = facts.get("todayBlocks") or []
        scheduled = sum(block["endMinutes"] - block["startMinutes"] for block in blocks)
        cells.append(("Scheduled", f"{minutes_label(scheduled)} · {len(blocks)} block{'s' if len(blocks) != 1 else ''}"))
    body = "".join(
        f'<div><div class="k">{escape(key)}</div><div class="v">{escape(value)}</div></div>'
        for key, value in cells
    )
    return f'<div class="strip">{body}</div>'


def uv_band(uv: float) -> str:
    """WHO's exposure bands. The number alone means nothing to most readers; the word does."""
    if uv < 3:
        return f"low ({round(uv)})"
    if uv < 6:
        return f"moderate ({round(uv)})"
    if uv < 8:
        return f"high ({round(uv)})"
    if uv < 11:
        return f"very high ({round(uv)})"
    return f"extreme ({round(uv)})"


def daylight_span(sunrise: float | None, sunset: float | None) -> str:
    if sunrise is None or sunset is None:
        return ""
    minutes = int(sunset - sunrise)
    return f"{minutes // 60}h{minutes % 60:02d}"


def _strip_clock(label: str | None) -> str:
    """Strip-cell times are already local labels ("7:07 AM"); tighten them for a narrow cell."""
    if not label:
        return ""
    return label.replace(":00 ", "").replace(" AM", "a").replace(" PM", "p")


# ---------------------------------------------------------------------------------------------
# Section: weather
# ---------------------------------------------------------------------------------------------

def section_weather_day_graph(payload: dict[str, Any], options: dict[str, Any], paper: dict[str, str]) -> str:
    hours = payload["facts"].get("weatherHours") or []
    if not hours:
        return section_shell("weather-day-graph", '<p class="muted small">No forecast cached for today.</p>')

    from_hour = options.get("fromHour", 6)
    to_hour = options.get("toHour", 23)
    window = [hour for hour in hours if from_hour * 60 <= hour["minuteOfDay"] <= to_hour * 60]
    source = window or hours
    start_min = from_hour * 60
    end_min = to_hour * 60
    span = max(1, end_min - start_min)

    # A 760-unit viewBox stretched to ~7.5in of paper is roughly 1:1, so an svg font-size of 11 is
    # about 11pt of ink. Small text was the main readability complaint on the first print.
    width, height = 760, 158
    temp_top, temp_bottom = 20, 96          # temperature plot band (svg y grows downward)
    rain_top, rain_bottom = 122, 148        # precipitation bars grow up from rain_bottom
    axis_y = 157
    label_size, tick_size = 11.5, 10.5

    def x_of(minute: int) -> float:
        return (minute - start_min) / span * width

    temps = [hour["temperatureF"] for hour in source if hour["temperatureF"] is not None]
    low, high = (min(temps), max(temps)) if temps else (0, 100)
    pad = max(3, (high - low) * 0.18)
    t_min, t_max = low - pad, high + pad

    def y_of(temp: float) -> float:
        return temp_bottom - (temp - t_min) / max(1.0, t_max - t_min) * (temp_bottom - temp_top)

    parts: list[str] = [f'<svg viewBox="0 0 {width} {height}" xmlns="http://www.w3.org/2000/svg">']

    # Night shading: a light band behind the whole plot wherever the sun is down. Sunrise/sunset are
    # computed for the household's coordinates (NWS `isDaytime` is a whole-hour flag that runs ~1h
    # late and was the thing being misread as an unexplained grey box).
    day = payload["facts"].get("weatherDay") or {}
    sunrise = day.get("sunriseMinutes")
    sunset = day.get("sunsetMinutes")
    runs: list[tuple[int, int]] = []
    if sunrise is not None and sunset is not None:
        if sunrise > start_min:
            runs.append((start_min, int(sunrise)))
        if sunset < end_min:
            runs.append((int(sunset), end_min))
    for run_start, run_end in runs:
        x0 = x_of(max(start_min, run_start))
        x1 = x_of(min(run_end, end_min))
        if x1 > x0:
            parts.append(
                f'<rect x="{x0:.1f}" y="{temp_top}" width="{x1 - x0:.1f}" height="{rain_bottom - temp_top}" '
                f'fill="{INK["night"]}"/>'
            )
            # Say what the grey means. It is the only unexplained mark on the page.
            if x1 - x0 > 26:
                parts.append(
                    f'<text x="{(x0 + x1) / 2:.1f}" y="{temp_top + 10}" font-size="{tick_size - 1}" '
                    f'fill="{INK["muted"]}" text-anchor="middle" letter-spacing="0.5">night</text>'
                )

    # Hour gridlines with labels every two hours on the shared axis.
    for minute in range(start_min, end_min + 1, 60):
        x = x_of(minute)
        parts.append(f'<line x1="{x:.1f}" y1="{temp_top}" x2="{x:.1f}" y2="{rain_bottom}" stroke="#e6e6e6" stroke-width="0.6"/>')
        if minute % 120 == 0 or minute == start_min or minute == end_min:
            label = "12a" if minute == 0 else ("12p" if minute == 720 else f"{(minute // 60) % 12}{'a' if minute < 720 else 'p'}")
            parts.append(
                f'<text x="{x:.1f}" y="{axis_y}" font-size="{tick_size}" fill="{INK["muted"]}" text-anchor="middle">{label}</text>'
            )

    # Precipitation bars: height is the probability, so a rainy afternoon reads at a glance.
    bar_width = max(3.0, width / span * 60 * 0.62)
    for hour in source:
        chance = hour["precipitationProbability"] or 0
        if chance <= 0:
            continue
        x = x_of(hour["minuteOfDay"] + 30)
        # A 3%-chance hour is real information; without a floor it renders as a zero-height bar.
        bar_height = max(2.0, (chance / 100) * (rain_bottom - rain_top))
        parts.append(
            f'<rect x="{x - bar_width / 2:.1f}" y="{rain_bottom - bar_height:.1f}" width="{bar_width:.1f}" '
            f'height="{bar_height:.1f}" fill="{INK["rain"]}" opacity="0.85"/>'
        )

    # Baseline for the rain band, so "0%" hours are visibly zero rather than absent.
    parts.append(f'<line x1="0" y1="{rain_bottom}" x2="{width}" y2="{rain_bottom}" stroke="{INK["hair"]}" stroke-width="0.7"/>')

    # Temperature curve + a marker and label on every third hour (readable, not cluttered).
    points = [(x_of(hour["minuteOfDay"] + 30), y_of(hour["temperatureF"])) for hour in source if hour["temperatureF"] is not None]
    if points:
        path = " ".join(f"{'M' if index == 0 else 'L'}{x:.1f},{y:.1f}" for index, (x, y) in enumerate(points))
        parts.append(f'<path d="{path}" fill="none" stroke="{INK["line"]}" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/>')
        for index, hour in enumerate(source):
            if hour["temperatureF"] is None:
                continue
            if index % 3 != 0 and index != len(source) - 1:
                continue
            x, y = x_of(hour["minuteOfDay"] + 30), y_of(hour["temperatureF"])
            parts.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="1.9" fill="{INK["line"]}"/>')
            parts.append(
                f'<text x="{x:.1f}" y="{y - 5.5:.1f}" font-size="{label_size}" font-weight="600" fill="{INK["line"]}" '
                f'text-anchor="middle">{round(hour["temperatureF"])}°</text>'
            )

    # Band captions sit in the left gutter of their own band, above the data rather than in it.
    parts.append(f'<text x="0" y="10" font-size="{tick_size}" fill="{INK["faint"]}" letter-spacing="0.4">TEMPERATURE °F</text>')
    parts.append(f'<text x="0" y="{rain_top - 6}" font-size="{tick_size}" fill="{INK["faint"]}" letter-spacing="0.4">PRECIPITATION %</text>')
    wind = _wind_summary(source)
    if wind:
        parts.append(f'<text x="{width}" y="{rain_top - 6}" font-size="{tick_size}" fill="{INK["faint"]}" text-anchor="end">wind {escape(wind)}</text>')
    parts.append("</svg>")

    stats = _weather_stats(source)
    rows = "".join(
        f'<div class="row"><span class="k">{escape(key)}</span><span class="v">{escape(value)}</span></div>'
        for key, value in stats
    )
    return section_shell(
        "weather-day-graph",
        f'<div class="weather"><div class="graph">{"".join(parts)}</div><div class="stats">{rows}</div></div>',
        note=_weather_note(source),
    )


def _wind_summary(hours: list[dict[str, Any]]) -> str:
    speeds = [hour["windMph"] for hour in hours if hour["windMph"] is not None]
    if not speeds:
        return ""
    return f"{round(min(speeds))}-{round(max(speeds))} mph"


def _weather_note(hours: list[dict[str, Any]]) -> str:
    forecasts = [hour["shortForecast"] for hour in hours if hour.get("shortForecast")]
    if not forecasts:
        return ""
    # Collapse consecutive identical conditions: "Sunny, Partly Cloudy, Clear".
    ordered: list[str] = []
    for forecast in forecasts:
        if not ordered or ordered[-1].lower() != forecast.lower():
            ordered.append(forecast)
    return " → ".join(ordered[:4])


def _weather_stats(hours: list[dict[str, Any]]) -> list[tuple[str, str]]:
    temps = [(hour["minuteOfDay"], hour["temperatureF"]) for hour in hours if hour["temperatureF"] is not None]
    rains = [(hour["minuteOfDay"], hour["precipitationProbability"] or 0) for hour in hours]
    rows: list[tuple[str, str]] = []
    if temps:
        high = max(temps, key=lambda item: item[1])
        low = min(temps, key=lambda item: item[1])
        rows.append(("High", f"{round(high[1])}° @ {_clock(high[0])}"))
        rows.append(("Low", f"{round(low[1])}° @ {_clock(low[0])}"))
    if rains:
        peak = max(rains, key=lambda item: item[1])
        rows.append(("Peak rain", f"{round(peak[1])}% @ {_clock(peak[0])}" if peak[1] > 0 else "none"))
    speeds = [hour["windMph"] for hour in hours if hour["windMph"] is not None]
    if speeds:
        rows.append(("Wind", f"max {round(max(speeds))} mph"))
    return rows


def _clock(minute: int) -> str:
    minute %= 1440
    hour, minute_part = divmod(minute, 60)
    suffix = "a" if hour < 12 else "p"
    display = hour % 12 or 12
    return f"{display}{suffix}" if minute_part == 0 else f"{display}:{minute_part:02d}{suffix}"


# ---------------------------------------------------------------------------------------------
# Section: today's schedule (ribbon + agenda)
# ---------------------------------------------------------------------------------------------

# Each agenda half repeats the head, because the two halves sit side by side and are read
# independently.
AGENDA_HEAD = (
    '<thead><tr><th>Time</th><th>Block</th><th style="text-align:right">Len</th><th>Kind</th></tr></thead>'
)

# The household printer is black and white, so the timeline encodes category by *value* only:
# a fixed commitment is dark, routine scaffolding is pale, and real work sits between them. That
# survives a grayscale print, a photocopy, and a photograph of the page.
# Three shades, black-and-white printer: a fixed commitment has to be the darkest thing on the page,
# routine is the papery background of the day, and everything else sits in between.
BLOCK_GREY = {
    "calendar": "#3d3d3d",     # calendar event: cannot move
    "routine": "#d2d2d2",      # sleep, meals, wind-down: the shape of the day
    "other": "#8d8d8d",        # everything else
}
BLOCK_STATUS_WORD = {
    "accepted": "accepted",
    "completed": "done",
    "proposed": "planned",
    "missed": "missed",
}


def block_category(block: dict[str, Any]) -> str:
    if block.get("type") == "calendar_event":
        return "calendar"
    if block.get("isRoutine"):
        return "routine"
    return "other"


def _block_ink(block: dict[str, Any]) -> str:
    """Label colour for a bar. #d2d2d2 needs dark text; the two darker greys need light text."""
    return "#ffffff" if block_category(block) in ("calendar", "other") else "#333333"


def _block_fill(block: dict[str, Any]) -> str:
    return BLOCK_GREY[block_category(block)]


def block_kind_label(block: dict[str, Any]) -> str:
    """The agenda's KIND column: what the block *is* (and, separately, how settled it is)."""
    category = block_category(block)
    status = BLOCK_STATUS_WORD.get(block.get("status", ""), block.get("status", ""))
    return category if status == "planned" else f"{category} · {status}"


def section_today_schedule(payload: dict[str, Any], options: dict[str, Any], paper: dict[str, str]) -> str:
    blocks = payload["facts"].get("todayBlocks") or []
    if not blocks:
        return section_shell("today-schedule", '<p class="muted small">Nothing scheduled today.</p>')

    # The ribbon spans the waking day only. Nobody needs to see 12-6am drawn to scale, so the strip
    # starts at 6am by default and clips anything earlier; the agenda below still lists every block,
    # so no scheduled time is lost.
    start_min = options.get("fromHour", 6) * 60
    end_min = options.get("toHour", 24) * 60
    span = max(60, end_min - start_min)

    # Overlapping blocks stack into lanes instead of covering each other. Google Calendar solves the
    # same problem on a vertical time axis by placing events side by side; with time running left to
    # right here, "side by side" is vertical, so the ribbon grows by a lane per conflict.
    placed, lanes = _pack_lanes(blocks)

    spans: list[str] = []
    for block, lane in placed:
        # Clip to the window: a 12-6:30am sleep block becomes a stub at the left edge.
        visible_start = max(block["startMinutes"], start_min)
        visible_end = min(block["endMinutes"], end_min)
        if visible_end <= visible_start:
            continue
        left = (visible_start - start_min) / span * 100
        width = max(0.55, (visible_end - visible_start) / span * 100)
        fill = _block_fill(block)
        # The bar carries the name, not just a colour: the ribbon is the agenda, read left to right.
        # A percentage of the ribbon converts to about 1.7 characters of tiny text, so the label is
        # clipped to what actually fits rather than to a fixed guess.
        room = int(width * 1.7)
        label = escape(truncate(block["title"], room)) if room >= 4 else ""
        tooltip = f'{escape(block["startLabel"])}–{escape(block["endLabel"])} {escape(block["title"])}'
        spans.append(
            f'<div class="span" style="left:{left:.2f}%;width:{width:.2f}%;top:{lane / lanes * 100:.3f}%;'
            f'height:{100 / lanes:.3f}%;background:{fill};color:{_block_ink(block)}" title="{tooltip}">'
            f'<span>{label}</span></div>'
        )

    ticks: list[str] = []
    for minute in range(start_min, end_min + 1, 60):
        ticks.append(f'<div class="tick" style="left:{(minute - start_min) / span * 100:.2f}%"></div>')
    axis = "".join(
        f'<span style="left:{(minute - start_min) / span * 100:.2f}%">{_clock(minute)}</span>'
        for minute in range(start_min, end_min + 1, 180)
    )

    rows: list[str] = []
    for block in blocks:
        swatch = _block_fill(block)
        rows.append(
            "<tr>"
            f'<td class="t">{escape(block["startLabel"])}–{escape(block["endLabel"])}</td>'
            f'<td><span class="swatch" style="background:{swatch}"></span>{escape(block["title"])}</td>'
            f'<td class="d">{dur(block["endMinutes"] - block["startMinutes"])}</td>'
            f'<td class="s muted">{escape(block_kind_label(block))}</td>'
            "</tr>"
        )

    # Split the agenda across two columns: a 10-block day costs half the vertical space, and the
    # reading order (down the left, then down the right) still matches the clock.
    half = (len(rows) + 1) // 2
    columns = [rows[:half], rows[half:]] if len(rows) > 6 else [rows]
    cells = "".join(
        f'<div><table class="agenda">{AGENDA_HEAD}<tbody>' + "".join(column) + "</tbody></table></div>"
        for column in columns
        if column
    )
    agenda = f'<div class="agendas{" two" if len(columns) == 2 else ""}">{cells}</div>'

    # 0.15in per lane holds one line of tiny text; a conflicted day gets a taller ribbon rather
    # than an unreadable one.
    ribbon_height = max(0.30, 0.15 * lanes)
    body = (
        f'<div class="ribbon" style="height:{ribbon_height:.2f}in">{"".join(ticks)}{"".join(spans)}</div>'
        f'<div class="axis">{axis}</div>'
        f"{_block_legend()}"
        f"{agenda}"
    )
    total = sum(block["endMinutes"] - block["startMinutes"] for block in blocks)
    return section_shell("today-schedule", body, note=f"{len(blocks)} blocks · {minutes_label(total)} scheduled")


# ---------------------------------------------------------------------------------------------
# Section: today's tasks
# ---------------------------------------------------------------------------------------------

def section_today_tasks(payload: dict[str, Any], options: dict[str, Any], paper: dict[str, str]) -> str:
    tasks = payload["facts"].get("todayTasks") or []
    if not tasks:
        return section_shell("today-tasks", '<p class="muted small">Nothing pinned to today.</p>')
    limit = options.get("descriptionChars", 220)
    max_desc_lines = options.get("descriptionLines", 4)
    cards: list[str] = []
    for task in tasks:
        priority_class = "pri-low" if task["priority"] >= 3 else ""
        meta: list[str] = []
        if task["durationMinutesRemaining"]:
            meta.append(minutes_label(task["durationMinutesRemaining"]))
        if task["deadlineLabel"]:
            meta.append(f'<span class="due">{escape(task["deadlineLabel"])}</span>')
        meta.append(escape(KANBAN_LABELS.get(task["kanbanStatus"], task["kanbanStatus"])))
        tags = "".join(f'<span class="tag">{escape(tag)}</span> ' for tag in task["tags"][:4])
        description = plain_text(task["description"] or "")
        desc_html = ""
        if description:
            text, clipped = clip(description, limit, max_desc_lines)
            body = "".join(
                f'<div class="dline">{escape(line)}</div>' for line in text.split("\n")
            )
            more_line = '<div class="dline more">…</div>' if clipped else ""
            desc_html = f'<div class="desc">{body}{more_line}</div>'
        cards.append(
            '<div class="task">'
            f'<div class="pri {priority_class}">P{task["priority"]}</div>'
            '<div class="body">'
            f'<div class="head"><b>{escape(task["title"])}</b>'
            f'<span class="meta">{" · ".join(meta)}</span></div>'
            + (f'<div class="tiny">{tags}</div>' if tags else "")
            + desc_html
            + "</div></div>"
        )
    half = (len(cards) + 1) // 2
    columns = [cards[:half], cards[half:]] if len(cards) > 4 else [cards]
    cells = "".join(f'<div class="tcol">{"".join(column)}</div>' for column in columns if column)
    two = " two" if len(columns) == 2 else ""
    return section_shell("today-tasks", f'<div class="tasks{two}">{cells}</div>', note=f"{len(tasks)} tasks")


# ---------------------------------------------------------------------------------------------
# Section: week ahead
# ---------------------------------------------------------------------------------------------

def section_week_ahead(payload: dict[str, Any], options: dict[str, Any], paper: dict[str, str]) -> str:
    week = payload["facts"].get("week") or []
    days = week[: options.get("days", 7)]
    if not days:
        return section_shell("week-ahead", '<p class="muted small">No days in the horizon.</p>')
    max_lines = options.get("linesPerDay", 5)

    columns: list[str] = []
    for day in days:
        weather_bits = []
        if day.get("highF") is not None and day.get("lowF") is not None:
            weather_bits.append(f'{day["highF"]}° / {day["lowF"]}°')
        if day.get("rainPercent"):
            weather_bits.append(f'{day["rainPercent"]}% rain')
        blocks = day.get("blocks") or []
        due = day.get("dueTasks") or []
        # Two labelled groups per day, because "what is planned" and "what must ship" are different
        # questions: a day can have scheduled work, due work, both, or neither. Each group only
        # claims the lines it needs, so an empty day stays short.
        groups: list[str] = []
        if blocks:
            lines = "".join(f'<div class="line">{line_html(block)}</div>' for block in blocks[:max_lines])
            remaining = len(blocks) - min(len(blocks), max_lines)
            overflow = f'<div class="more">+{remaining} more</div>' if remaining > 0 else ""
            groups.append(f'<div class="grp">scheduled</div>{lines}{overflow}')
        if due:
            items = "".join(f'<div class="line due">{escape(truncate(task["title"], 46))}</div>' for task in due[:max_lines])
            remaining = len(due) - min(len(due), max_lines)
            overflow = f'<div class="more">+{remaining} more</div>' if remaining > 0 else ""
            groups.append(f'<div class="grp due">due</div>{items}{overflow}')
        if not groups:
            groups.append('<div class="empty">nothing</div>')
        columns.append(
            f'<div class="day{" today" if day["isToday"] else ""}">'
            '<div class="dhead">'
            f'<div class="wd">{escape(day["weekdayLabel"])}</div>'
            f'<div class="dn">{escape(day["monthDayLabel"])}</div>'
            f'<div class="wx">{escape(" · ".join(weather_bits))}</div>'
            "</div>"
            f"{mini_timeline(blocks)}"
            f'{"".join(groups)}</div>'
        )

    attention = payload["facts"].get("attention") or []
    att_html = (
        '<div class="attention-wrap"><div class="attention-head">Needs attention</div>'
        '<ul class="attention">' + "".join(f"<li>{escape(line)}</li>" for line in attention) + "</ul></div>"
        if attention
        else ""
    )
    planned = sum(1 for day in days if day.get("blocks"))
    due_count = sum(len(day.get("dueTasks") or []) for day in days)
    note = f"{planned} of {len(days)} days planned · {due_count} due"
    return section_shell("week-ahead", f'<div class="week">{"".join(columns)}</div>{att_html}', note=note)


def _pack_lanes(blocks: list[dict[str, Any]]) -> tuple[list[tuple[dict[str, Any], int]], int]:
    """First-fit lane assignment in start order.

    Only blocks that actually conflict share vertical space, so an ordinary day stays one lane tall
    and a badly double-booked one grows instead of hiding work under other work. A day has at most
    a few dozen blocks, so greedy is exactly as good as anything cleverer here.
    """
    lane_ends: list[int] = []
    placed: list[tuple[dict[str, Any], int]] = []
    for block in sorted(blocks, key=lambda item: (item["startMinutes"], -item["endMinutes"])):
        for index, end in enumerate(lane_ends):
            if block["startMinutes"] >= end:
                lane_ends[index] = block["endMinutes"]
                placed.append((block, index))
                break
        else:
            placed.append((block, len(lane_ends)))
            lane_ends.append(block["endMinutes"])
    return placed, max(1, len(lane_ends))


def _block_legend() -> str:
    """Three swatches and three words: without this the grey shades are guesswork."""
    items = "".join(
        f'<span class="lg"><span class="sw" style="background:{BLOCK_GREY[key]}"></span>{label}</span>'
        for key, label in (("calendar", "calendar"), ("routine", "routine"), ("other", "other"))
    )
    return f'<div class="legend">{items}</div>'


def _short_clock(minute: int) -> str:
    minute %= 1440
    hour, rest = divmod(minute, 60)
    suffix = "a" if hour < 12 else "p"
    display = hour % 12 or 12
    return f"{display}:{rest:02d}{suffix}" if rest else f"{display}{suffix}"


def mini_timeline(blocks: list[dict[str, Any]]) -> str:
    """A 5pt day-density strip: the same shape as the big ribbon, at one glance per column."""
    if not blocks:
        return ""
    spans = "".join(
        f'<div class="span" style="left:{block["startMinutes"] / 1440 * 100:.2f}%;'
        f'width:{max(0.6, (block["endMinutes"] - block["startMinutes"]) / 1440 * 100):.2f}%;'
        f'background:{_block_fill(block)}"></div>'
        for block in blocks
    )
    return f'<div class="mini">{spans}</div>'


def line_html(block: dict[str, Any]) -> str:
    """Week-cell block line: a compact start time, then the title. The cell is ~1in wide, so the
    long clock label ("12:00 AM") would eat the whole line and wrap every title."""
    return f'<span class="h">{_short_clock(block["startMinutes"])}</span> {escape(block["title"])}'


# ---------------------------------------------------------------------------------------------
# Section: board snapshot
# ---------------------------------------------------------------------------------------------

def section_board_snapshot(payload: dict[str, Any], options: dict[str, Any], paper: dict[str, str]) -> str:
    wanted = options.get("columns") or ["inbox", "ready", "in_progress", "waiting"]
    per_column = options.get("perColumn", 6)
    columns = [column for status in wanted for column in payload["facts"].get("board") or [] if column["status"] == status]
    if not columns:
        return section_shell("board-snapshot", '<p class="muted small">No board data.</p>')

    cells: list[str] = []
    for column in columns:
        items = []
        for task in column["tasks"][:per_column]:
            bits = []
            if task["durationMinutesRemaining"]:
                bits.append(minutes_label(task["durationMinutesRemaining"]))
            if task["deadlineLabel"]:
                bits.append(task["deadlineLabel"])
            tail = f' <span class="m">{escape(" · ".join(bits))}</span>' if bits else ""
            items.append(f'<div class="item">{escape(task["title"])}{tail}</div>')
        if not items:
            items.append('<div class="empty tiny muted">empty</div>')
        remaining = column["total"] - min(len(column["tasks"]), per_column)
        more = f'<div class="more">+{remaining} more</div>' if remaining > 0 else ""
        cells.append(
            '<div class="col">'
            f'<div class="chead"><b>{escape(column["label"])}</b><span class="n">{column["total"]}</span></div>'
            f'{"".join(items)}{more}</div>'
        )
    return section_shell("board-snapshot", f'<div class="board">{"".join(cells)}</div>')


# ---------------------------------------------------------------------------------------------
# Document
# ---------------------------------------------------------------------------------------------

RENDERERS: dict[str, Callable[[dict[str, Any], dict[str, Any], dict[str, str]], str]] = {
    "weather-day-graph": section_weather_day_graph,
    "today-schedule": section_today_schedule,
    "today-tasks": section_today_tasks,
    "week-ahead": section_week_ahead,
    "board-snapshot": section_board_snapshot,
}

DEFAULT_LAYOUT: list[dict[str, Any]] = [
    {"kind": "weather-day-graph"},
    {"kind": "today-schedule"},
    {"kind": "today-tasks"},
    {"kind": "week-ahead"},
    {"kind": "board-snapshot"},
]


def build_html(payload: dict[str, Any], paper_name: str = "letter") -> str:
    """The document shell. Only sections named in `payload.layout` are rendered, in that order."""
    paper = PAPER.get(paper_name, PAPER["letter"])
    layout = payload.get("layout") or DEFAULT_LAYOUT
    sections: list[str] = []
    for entry in layout:
        renderer = RENDERERS.get(entry["kind"])
        if renderer is None:
            continue  # An unknown kind is a caller bug; skipping beats crashing the print.
        options = {key: value for key, value in entry.items() if key != "kind"}
        sections.append(renderer(payload, options, paper))
    return (
        "<!doctype html><html><head><meta charset=\"utf-8\">"
        f"<title>{escape(payload.get('dateLabel', 'Mind Palace briefing'))}</title>"
        f"<style>{css(paper)}</style></head><body>"
        f"{masthead(payload)}{summary_strip(payload)}{''.join(sections)}"
        "</body></html>"
    )


def main() -> int:
    try:
        request = json.loads(sys.stdin.read() or "{}")
        payload = request["payload"]
        paper_name = request.get("paper", "letter")
        action = request.get("action", "render")
        html = build_html(payload, paper_name)
        if action == "html":
            print(json.dumps({"html": html}))
            return 0
        from weasyprint import HTML  # imported late so `action: "html"` needs no PDF stack
        document = HTML(string=html, base_url="/").render()
        pdf = document.write_pdf()
        if action == "write":
            with open(request["outPath"], "wb") as handle:
                handle.write(pdf)
            print(json.dumps({"pdfPath": request["outPath"], "pages": len(document.pages)}))
            return 0
        print(json.dumps({"pdfBase64": base64.b64encode(pdf).decode("ascii"), "pages": len(document.pages)}))
        return 0
    except Exception as error:  # noqa: BLE001 - the protocol wants a JSON error, whatever it is
        print(json.dumps({"error": f"{type(error).__name__}: {error}"}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
