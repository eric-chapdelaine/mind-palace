import type { HealthActivity } from "@mind-palace/shared";
import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { api } from "./api";
import { useCrumbTitle } from "./components/Breadcrumbs";
import { HealthEditForm } from "./components/HealthEditForm";
import { HealthDetails, MetricGrid } from "./components/HealthMetrics";
import { formatClock, formatDate, formatDistance, formatMinutes, elapsedMinutes } from "./lib/health";

/** Owner title wins; otherwise show Garmin's name. */
function activityTitle(activity: HealthActivity): string {
  return activity.title ?? activity.providerTitle;
}

export function HealthActivityPage() {
  const id = Number(useParams().id);
  const [activity, setActivity] = useState<HealthActivity | null>(null);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const registerCrumbTitle = useCrumbTitle();

  async function load() {
    try {
      const next = await api.healthActivity(id);
      setActivity(next);
      setTitle(next.title ?? "");
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
    if (activity) registerCrumbTitle(`/health_activity/${id}`, activityTitle(activity));
  }, [activity, id, registerCrumbTitle]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const next = await api.updateHealthActivity(id, { title: title.trim() || null, notes: notes.trim() || null });
      setActivity(next);
      setError(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setBusy(false);
    }
  }

  if (!activity) {
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
            <span className="task-type">Garmin activity</span>
            <span className="detail-public-id">{activity.activityType}</span>
          </div>
          <h1>{activityTitle(activity)}</h1>
          <p className="muted">
            {formatDate(activity.activityDate)} · {formatClock(activity.startAt)} - {formatClock(activity.endAt)}
          </p>
        </div>
      </header>

      <div className="detail-grid">
        <div className="detail-main">
          <section className="detail-section">
            <div className="section-label">Metrics</div>
            <MetricGrid metrics={[
              { label: "Elapsed time", value: formatMinutes(elapsedMinutes(activity.startAt, activity.endAt)) },
              { label: "Recorded time", value: formatMinutes(activity.durationMinutes) },
              { label: "Moving time", value: formatMinutes(activity.movingMinutes) },
              { label: "Distance", value: formatDistance(activity.distanceMeters) },
              { label: "Calories", value: activity.calories === null ? "" : `${Math.round(activity.calories)} cal` },
              { label: "Average HR", value: activity.avgHeartRate === null ? "" : `${activity.avgHeartRate} bpm` },
              { label: "Max HR", value: activity.maxHeartRate === null ? "" : `${activity.maxHeartRate} bpm` },
            ]} />
          </section>

          <HealthDetails details={activity.details} />

          <HealthEditForm
            heading="Your details"
            hint={`Garmin name: ${activity.providerTitle}`}
            title={title}
            onTitleChange={setTitle}
            titlePlaceholder={activity.providerTitle}
            notes={notes}
            onNotesChange={setNotes}
            notesPlaceholder="How did it feel?"
            onSubmit={save}
            busy={busy}
          />
        </div>
      </div>
    </main>
  );
}
