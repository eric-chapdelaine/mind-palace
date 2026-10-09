import type { JsonObject } from "@mind-palace/shared";

export interface Metric {
  label: string;
  value: string;
}

/** Simple label/value grid used by the sleep and activity detail pages. */
export function MetricGrid({ metrics }: { metrics: Metric[] }) {
  const rows = metrics.filter((metric) => metric.value);
  if (rows.length === 0) return null;
  return (
    <dl className="health-metrics">
      {rows.map((metric) => (
        <div className="health-metric" key={metric.label}>
          <dt>{metric.label}</dt>
          <dd>{metric.value}</dd>
        </div>
      ))}
    </dl>
  );
}

const detailLabels: Record<string, string> = {
  trainingEffectLabel: "Training effect",
  aerobicTrainingEffect: "Aerobic effect",
  anaerobicTrainingEffect: "Anaerobic effect",
  trainingLoad: "Training load",
  elevationGainMeters: "Elevation gain (m)",
  steps: "Steps",
  averageCadence: "Average cadence",
  maxSpeedMetersPerSecond: "Max speed (m/s)",
  locationName: "Location",
  sleepScoreQualifier: "Score qualifier",
  sleepNeedMinutes: "Sleep need (min)",
  awakeCount: "Awake count",
  averageSpO2: "Average SpO2 (%)",
  lowestSpO2: "Lowest SpO2 (%)",
  averageRespiration: "Average respiration",
  breathingDisruptionSeverity: "Breathing disruption",
};

function formatValue(value: unknown): string {
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  return String(value);
}

/** Renders whatever curated provider metrics the worker stored in `details_json`. */
export function HealthDetails({ details }: { details: JsonObject }) {
  const rows = Object.entries(details).filter(([, value]) => value !== null && value !== undefined && value !== "");
  if (rows.length === 0) return null;
  return (
    <section className="detail-section">
      <div className="section-label">Provider details</div>
      <MetricGrid metrics={rows.map(([key, value]) => ({ label: detailLabels[key] ?? key, value: formatValue(value) }))} />
    </section>
  );
}
