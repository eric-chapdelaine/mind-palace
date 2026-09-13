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
  constructor(private readonly tasks: TaskRepository) {}

  async getForecast(force = false): Promise<WeatherForecast[]> {
    const cached = this.tasks.listWeather();
    if (!force && cached.length > 0) return cached;
    const pointsResponse = await fetch("https://api.weather.gov/points/42.3601,-71.0589", { headers });
    if (!pointsResponse.ok) throw new Error(`Weather location request failed: ${pointsResponse.status}`);
    const points = await pointsResponse.json() as NwsPointsResponse;
    const forecastResponse = await fetch(points.properties.forecastHourly, { headers });
    if (!forecastResponse.ok) throw new Error(`Hourly weather request failed: ${forecastResponse.status}`);
    const forecast = await forecastResponse.json() as NwsForecastResponse;
    const fetchedAt = new Date();
    const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(fetchedAt);
    const weekdayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
    const end = new Date(fetchedAt);
    end.setUTCDate(end.getUTCDate() + (7 - weekdayIndex));
    const values = forecast.properties.periods
      .filter((period) => new Date(period.startTime) < end)
      .map((period) => ({
        forecastAt: new Date(period.startTime).toISOString(),
        temperatureF: period.temperature,
        precipitationProbability: period.probabilityOfPrecipitation.value,
        shortForecast: period.shortForecast,
      }));
    this.tasks.upsertWeather(values, fetchedAt.toISOString(), new Date(fetchedAt.getTime() + 8 * 60 * 60 * 1000).toISOString());
    return this.tasks.listWeather();
  }
}
