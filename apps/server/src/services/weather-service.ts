import type { TaskRepository } from "@mind-palace/database";
import type { WeatherForecast } from "@mind-palace/shared";

interface NwsPointsResponse {
  properties: { forecastHourly: string };
}

interface NwsForecastResponse {
  properties: {
    periods: Array<{
      startTime: string;
      temperature: number;
      probabilityOfPrecipitation: { value: number | null };
      windSpeed: string;
      isDaytime: boolean;
      shortForecast: string;
    }>;
  };
}

const headers = { "User-Agent": "mind-palace/0.1 (local personal project)", Accept: "application/geo+json" };

/**
 * NWS — the source of every other forecast column — publishes no UV index, so this one field is
 * supplemented from Open-Meteo. Epoch seconds keep the join exact: both APIs report on the hour.
 */
const OPEN_METEO_UV_URL =
  "https://api.open-meteo.com/v1/forecast?latitude=42.3601&longitude=-71.0589&hourly=uv_index&forecast_days=7&timeformat=unixtime&timezone=UTC";

interface OpenMeteoUvResponse {
  hourly?: { time?: number[]; uv_index?: (number | null)[] };
}

/** NWS reports wind as e.g. "10 mph" or "5 to 10 mph"; keep the leading number. */
function parseWindMph(value: string | undefined): number | null {
  if (!value) return null;
  const match = /(\d+(?:\.\d+)?)/.exec(value);
  return match ? Number(match[1]) : null;
}

export class WeatherService {
  private inFlight: Promise<void> | null = null;

  constructor(private readonly tasks: TaskRepository) {}

  /**
   * Refreshes the cache when it is empty/expired (or `force` is set). De-duplicates concurrent
   * callers so the scheduled job and an on-request read never both hit NWS at once.
   */
  async ensureFresh(force = false): Promise<void> {
    if (!force && this.tasks.listWeather().length > 0) return;
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.fetchAndStore().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /**
   * Ensures the forecast cache is fresh, then returns stored hours for the requested range
   * (including expired rows, so past days on the calendar still render).
   */
  async getWeather(force = false, from?: string, to?: string): Promise<WeatherForecast[]> {
    await this.ensureFresh(force);
    return this.tasks.listWeatherHistory(from, to);
  }

  /**
   * UV index keyed by ISO hour. Deliberately tolerant: a failed UV call returns an empty map so a
   * forecast sync degrades to "no UV" rather than failing outright.
   */
  private async fetchUvIndex(): Promise<Map<string, number | null>> {
    const byHour = new Map<string, number | null>();
    try {
      const response = await fetch(OPEN_METEO_UV_URL);
      if (!response.ok) return byHour;
      const payload = await response.json() as OpenMeteoUvResponse;
      const times = payload.hourly?.time ?? [];
      const values = payload.hourly?.uv_index ?? [];
      times.forEach((epochSeconds, index) => {
        const uv = values[index];
        byHour.set(new Date(epochSeconds * 1000).toISOString(), uv === null || uv === undefined ? null : uv);
      });
    } catch {
      // Network/parse failure: print "—" for UV instead of losing the whole forecast.
    }
    return byHour;
  }

  private async fetchAndStore(): Promise<void> {
    const pointsResponse = await fetch("https://api.weather.gov/points/42.3601,-71.0589", { headers });
    if (!pointsResponse.ok) throw new Error(`Weather location request failed: ${pointsResponse.status}`);
    const points = await pointsResponse.json() as NwsPointsResponse;
    const forecastResponse = await fetch(points.properties.forecastHourly, { headers });
    if (!forecastResponse.ok) throw new Error(`Hourly weather request failed: ${forecastResponse.status}`);
    const forecast = await forecastResponse.json() as NwsForecastResponse;
    const fetchedAt = new Date();
    const uvByHour = await this.fetchUvIndex();
    // Store every hourly period NWS returns; the API already limits the horizon to ~7 days.
    const values = forecast.properties.periods
      .map((period) => {
        const forecastAt = new Date(period.startTime).toISOString();
        return {
          forecastAt,
          temperatureF: period.temperature,
          precipitationProbability: period.probabilityOfPrecipitation.value,
          windMph: parseWindMph(period.windSpeed),
          isDaytime: period.isDaytime,
          uvIndex: uvByHour.get(forecastAt) ?? null,
          shortForecast: period.shortForecast,
        };
      });
    this.tasks.upsertWeather(values, fetchedAt.toISOString(), new Date(fetchedAt.getTime() + 8 * 60 * 60 * 1000).toISOString());
  }
}
