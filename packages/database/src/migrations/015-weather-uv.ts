/**
 * UV index per forecast hour. NWS (the source of every other weather column) does not publish a UV
 * index, so this one field is filled from Open-Meteo in `WeatherService`. Nullable: cached rows from
 * before this migration, and any hour the supplement fails to cover, stay null and print as "—".
 */
export const weatherUvMigration = {
  // 14 is taken by the meal-tags migration on the installed database; never reuse a version.
  version: 15,
  name: "weather uv index",
  sql: String.raw`
    ALTER TABLE weather_forecasts ADD COLUMN uv_index REAL;
  `,
} as const;
