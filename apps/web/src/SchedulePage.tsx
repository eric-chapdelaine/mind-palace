import type { Schedule, TaskSummary, WeatherForecast } from "@mind-palace/shared";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "./api";

const HOUR_HEIGHT = 48;

function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function addDays(date: Date, count: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + count);
  return result;
}

function sameDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

export function SchedulePage() {
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [weather, setWeather] = useState<WeatherForecast[]>([]);
  const [rangeStart, setRangeStart] = useState(() => startOfDay(new Date()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const calendar = useRef<HTMLDivElement>(null);

  async function load() {
    try {
      const [nextSchedule, nextTasks, nextWeather] = await Promise.all([
        api.schedule(),
        api.tasks(),
        api.weather(),
      ]);
      setSchedule(nextSchedule);
      setTasks(nextTasks);
      setWeather(nextWeather);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const today = new Date();
    const hour = today >= rangeStart && today < addDays(rangeStart, 7)
      ? Math.max(0, today.getHours() - 1)
      : 7;
    if (calendar.current) calendar.current.scrollTop = hour * HOUR_HEIGHT;
  }, [rangeStart]);

  async function generate() {
    setBusy(true);
    try {
      setSchedule(await api.generateSchedule());
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  }

  const now = new Date();
  const days = Array.from({ length: 7 }, (_, index) => addDays(rangeStart, index));
  const rangeEnd = addDays(rangeStart, 7);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const timeBlocks = (schedule?.timeBlocks ?? [])
    .filter((block) => block.status !== "superseded")
    .map((block) => ({ ...block, key: `block-${block.id}` }));
  const fixedBlocks = tasks
    .filter((task) => task.fixedStart && task.fixedEnd)
    .filter((task) => !timeBlocks.some((block) => (
      block.taskId === task.id
      && block.startAt === task.fixedStart
      && block.endAt === task.fixedEnd
    )))
    .map((task) => ({
      key: `fixed-${task.id}`,
      taskId: task.id,
      startAt: task.fixedStart!,
      endAt: task.fixedEnd!,
      status: "accepted" as const,
      source: "calendar" as const,
      id: 0,
    }));
  const visibleBlocks = [...timeBlocks, ...fixedBlocks].filter((block) => (
    new Date(block.startAt) < rangeEnd && new Date(block.endAt) > rangeStart
  ));
  const rangeLabel = `${rangeStart.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })} - ${addDays(rangeStart, 6).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;

  return <main className="schedule-shell">
    <nav className="detail-nav">
      <Link to="/">Back to board</Link>
      <span>America/New_York</span>
    </nav>
    <header className="schedule-header">
      <div>
        <div className="eyebrow">30-minute CP-SAT plan</div>
        <h1>Weekly schedule</h1>
        <p>Planned and fixed work across seven days.</p>
      </div>
      <button className="primary-button" disabled={busy} onClick={() => void generate()}>
        {busy ? "Optimizing..." : "Generate schedule"}
      </button>
    </header>
    {error && <div className="error-banner">{error}</div>}
    <section className="calendar-toolbar">
      <div className="button-row">
        <button onClick={() => setRangeStart(addDays(rangeStart, -7))} aria-label="Previous seven days">Previous</button>
        <button onClick={() => setRangeStart(startOfDay(new Date()))}>Today</button>
        <button onClick={() => setRangeStart(addDays(rangeStart, 7))} aria-label="Next seven days">Next</button>
      </div>
      <h2>{rangeLabel}</h2>
      <span>{schedule?.runs[0]?.status ?? "Not generated"}</span>
    </section>
    <section className="weather-strip">
      {weather
        .filter((item) => new Date(item.forecastAt) >= rangeStart && new Date(item.forecastAt) < rangeEnd)
        .slice(0, 14)
        .map((item) => <div key={item.forecastAt}>
          <time>{new Date(item.forecastAt).toLocaleString(undefined, { weekday: "short", hour: "numeric" })}</time>
          <strong>{item.temperatureF ?? "-"}°</strong>
          <span>{item.precipitationProbability ?? 0}% rain</span>
        </div>)}
    </section>
    <div className="calendar-scroll" ref={calendar}>
      <div className="calendar-grid">
        <div className="calendar-corner" />
        {days.map((day) => <header
          className={`calendar-day-heading ${sameDay(day, now) ? "today" : ""} ${day < startOfDay(now) ? "past" : ""}`}
          key={day.toISOString()}
        >
          <span>{day.toLocaleDateString(undefined, { weekday: "short" })}</span>
          <strong>{day.getDate()}</strong>
        </header>)}
        <div className="time-gutter">
          {Array.from({ length: 24 }, (_, hour) => <time key={hour} style={{ top: hour * HOUR_HEIGHT }}>
            {new Date(2020, 0, 1, hour).toLocaleTimeString([], { hour: "numeric" })}
          </time>)}
        </div>
        {days.map((day) => {
          const dayEnd = addDays(day, 1);
          const blocks = visibleBlocks.filter((block) => (
            new Date(block.startAt) < dayEnd && new Date(block.endAt) > day
          ));
          const elapsedMinutes = sameDay(day, now)
            ? now.getHours() * 60 + now.getMinutes()
            : day < startOfDay(now) ? 1440 : 0;

          return <section className="calendar-day" key={day.toISOString()}>
            {elapsedMinutes > 0 && <div
              className="elapsed-time"
              style={{ height: elapsedMinutes * HOUR_HEIGHT / 60 }}
            />}
            {blocks.map((block) => {
              const start = new Date(Math.max(new Date(block.startAt).getTime(), day.getTime()));
              const end = new Date(Math.min(new Date(block.endAt).getTime(), dayEnd.getTime()));
              const top = (start.getHours() * 60 + start.getMinutes()) * HOUR_HEIGHT / 60;
              const height = Math.max(24, (end.getTime() - start.getTime()) / 3_600_000 * HOUR_HEIGHT);
              const task = taskById.get(block.taskId);
              const compact = height < HOUR_HEIGHT;
              const startLabel = new Date(block.startAt).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              });
              const endLabel = new Date(block.endAt).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              });
              const title = task?.title ?? `Task ${block.taskId}`;

              return <article
                className={`calendar-event block-${block.status} ${compact ? "calendar-event-compact" : ""} ${new Date(block.endAt) <= now ? "schedule-past" : ""}`}
                key={`${block.key}-${day.toISOString()}`}
                style={{ top, height }}
                title={`${title}: ${startLabel} - ${endLabel}`}
              >
                <div className="calendar-event-summary">
                  <time>{compact ? startLabel : `${startLabel} - ${endLabel}`}</time>
                  <Link to={`/tasks/${block.taskId}`}><strong>{title}</strong></Link>
                  {compact && block.status === "proposed" && <button
                    aria-label={`Accept ${title}`}
                    onClick={() => void api.acceptTaskSchedule(block.taskId).then(setSchedule)}
                  >Accept</button>}
                </div>
                {!compact && <span>{block.status}</span>}
                {!compact && block.status === "proposed" && <button
                  onClick={() => void api.acceptTaskSchedule(block.taskId).then(setSchedule)}
                >Accept</button>}
              </article>;
            })}
          </section>;
        })}
      </div>
    </div>
    {schedule && schedule.unscheduledTaskIds.length > 0 && <section className="unscheduled">
      <div className="section-label">Unscheduled</div>
      <h2>Tasks without calendar space</h2>
      {schedule.unscheduledTaskIds.map((id) => <Link key={id} to={`/tasks/${id}`}>
        {taskById.get(id)?.title ?? `Task ${id}`}
      </Link>)}
    </section>}
  </main>;
}
