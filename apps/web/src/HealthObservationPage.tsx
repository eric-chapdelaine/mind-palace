import type { SleepSession } from "@mind-palace/shared";
import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { api } from "./api";
import { useCrumbTitle } from "./components/Breadcrumbs";
import { HealthEditForm } from "./components/HealthEditForm";
import { HealthDetails, MetricGrid } from "./components/HealthMetrics";
import { formatClock, formatDate, formatMinutes } from "./lib/health";

export function HealthObservationPage() {
  const id = Number(useParams().id);
  const [session, setSession] = useState<SleepSession | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const registerCrumbTitle = useCrumbTitle();

  async function load() {
    try {
      const next = await api.healthObservation(id);
      setSession(next);
      setNotes(next.notes ?? "");
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }

  useEffect(() => {
    void load();
  }, [id]);

  useEffect(() => {
    if (session) registerCrumbTitle(`/health_observation/${id}`, `Sleep · ${formatDate(session.calendarDate)}`);
  }, [session, id, registerCrumbTitle]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const next = await api.updateHealthObservation(id, { notes: notes.trim() || null });
      setSession(next);
      setError(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setBusy(false);
    }
  }

  if (!session) {
    return <main className="detail-shell">
      {error ? <div className="error-banner">{error}</div> : <p>Loading...</p>}
    </main>;
  }

  return (
    <main className="detail-shell">
      {error && <div className="error-banner">{error}</div>}
      <header className="detail-header">
        <div>
          <div className="task-card-topline">
            <span className="task-type">Garmin sleep</span>
            <span className="detail-public-id">{session.calendarDate}</span>
          </div>
          <h1>Sleep</h1>
          <p className="muted">
            {formatDate(session.calendarDate)} · {formatClock(session.startAt)} - {formatClock(session.endAt)}
          </p>
        </div>
      </header>

      <div className="detail-grid">
        <div className="detail-main">
          <section className="detail-section">
            <div className="section-label">Metrics</div>
            <MetricGrid metrics={[
              { label: "Sleep score", value: session.sleepScore === null ? "" : String(session.sleepScore) },
              { label: "Total sleep", value: formatMinutes(session.totalSleepMinutes) },
              { label: "Deep", value: formatMinutes(session.deepSleepMinutes) },
              { label: "Light", value: formatMinutes(session.lightSleepMinutes) },
              { label: "REM", value: formatMinutes(session.remSleepMinutes) },
              { label: "Awake", value: formatMinutes(session.awakeMinutes) },
              { label: "Average HR", value: session.avgHeartRate === null ? "" : `${session.avgHeartRate} bpm` },
              { label: "Average stress", value: session.avgStress === null ? "" : String(Math.round(session.avgStress)) },
            ]} />
          </section>

          <HealthDetails details={session.details} />

          <HealthEditForm
            heading="Your notes"
            hint="Anything worth remembering about this night."
            notes={notes}
            onNotesChange={setNotes}
            notesPlaceholder="How did you sleep?"
            onSubmit={save}
            busy={busy}
          />
        </div>
      </div>
    </main>
  );
}
