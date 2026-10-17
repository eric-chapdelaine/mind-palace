/**
 * Adds the two NWS hourly fields the life-scheduling rules need to evaluate "nice weather":
 * wind speed and whether the hour is daytime. Both come from the same forecast response; they are
 * nullable because older cached rows and some periods omit them.
 */
export const weatherDetailMigration = {
  version: 13,
  name: "weather wind and daylight",
  sql: String.raw`
    ALTER TABLE weather_forecasts ADD COLUMN wind_mph REAL;
    ALTER TABLE weather_forecasts ADD COLUMN is_daytime INTEGER;
  `,
} as const;
