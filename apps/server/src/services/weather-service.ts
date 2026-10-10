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
      shortForecast: string;
    }>;
  };
}

const headers = { "User-Agent": "mind-palace/0.1 (local personal project)", Accept: "application/geo+json" };

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

  private async fetchAndStore(): Promise<void> {
    const pointsResponse = await fetch("https://api.weather.gov/points/42.3601,-71.0589", { headers });
    if (!pointsResponse.ok) throw new Error(`Weather location request failed: ${pointsResponse.status}`);
    const points = await pointsResponse.json() as NwsPointsResponse;
    const forecastResponse = await fetch(points.properties.forecastHourly, { headers });
    if (!forecastResponse.ok) throw new Error(`Hourly weather request failed: ${forecastResponse.status}`);
    const forecast = await forecastResponse.json() as NwsForecastResponse;
    const fetchedAt = new Date();
    // Store every hourly period NWS returns; the API already limits the horizon to ~7 days.
    const values = forecast.properties.periods
      .map((period) => ({
        forecastAt: new Date(period.startTime).toISOString(),
        temperatureF: period.temperature,
        precipitationProbability: period.probabilityOfPrecipitation.value,
        shortForecast: period.shortForecast,
      }));
    this.tasks.upsertWeather(values, fetchedAt.toISOString(), new Date(fetchedAt.getTime() + 8 * 60 * 60 * 1000).toISOString());
  }
}
