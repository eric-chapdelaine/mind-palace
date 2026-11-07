/**
 * A weather rule measures dimensions, so each one becomes a dimension with an ideal.
 *
 * The flat shape (`minTemperatureF`, `maxPrecipitationProbability`, `requireDaytime`, …) could only
 * express "is this slot acceptable", so a soft weather rule was worth its whole weight or nothing:
 * a foggy 20%-rain Saturday scored the same as a sunny 0% Sunday, and the scheduler had no reason
 * to prefer the better day. Each dimension now carries the ideal that credit decays from, its
 * limits, and its own weight.
 *
 * Existing rules convert to the neutral reading of what they already said: a temperature ideal at
 * the midpoint of its bounds (a bound on one side only keeps its bound as the ideal, which the
 * worker reads as a plateau), rain and wind ideal at zero, and `requireDaytime` as a `daytime`
 * metric. All weights start at 1, so no preference is invented — the mix is the owner's to set.
 */

import type { Migration } from "./index.js";

export const weatherMetricsMigration: Migration = {
  version: 19,
  name: "weather rules grade each dimension",
  sql: `
    UPDATE scheduler_rules
    SET effect_json = json_set(
      json_remove(effect_json,
        '$.minTemperatureF', '$.maxTemperatureF',
        '$.maxPrecipitationProbability', '$.maxWindMph', '$.requireDaytime'),
      '$.metrics',
      json((
        SELECT json_group_object(metric, json(body))
        FROM (
          SELECT 'temperatureF' AS metric,
                 json_object('ideal', (low + high) / 2.0, 'min', low, 'max', high, 'weight', 1) AS body
            FROM (SELECT json_extract(effect_json, '$.minTemperatureF') AS low,
                         json_extract(effect_json, '$.maxTemperatureF') AS high)
           WHERE low IS NOT NULL AND high IS NOT NULL
          UNION ALL
          SELECT 'temperatureF', json_object('ideal', low, 'min', low, 'weight', 1)
            FROM (SELECT json_extract(effect_json, '$.minTemperatureF') AS low,
                         json_extract(effect_json, '$.maxTemperatureF') AS high)
           WHERE low IS NOT NULL AND high IS NULL
          UNION ALL
          SELECT 'temperatureF', json_object('ideal', high, 'max', high, 'weight', 1)
            FROM (SELECT json_extract(effect_json, '$.minTemperatureF') AS low,
                         json_extract(effect_json, '$.maxTemperatureF') AS high)
           WHERE low IS NULL AND high IS NOT NULL
          UNION ALL
          SELECT 'precipitationProbability', json_object('ideal', 0, 'max', bound, 'weight', 1)
            FROM (SELECT json_extract(effect_json, '$.maxPrecipitationProbability') AS bound)
           WHERE bound IS NOT NULL
          UNION ALL
          SELECT 'windMph', json_object('ideal', 0, 'max', bound, 'weight', 1)
            FROM (SELECT json_extract(effect_json, '$.maxWindMph') AS bound)
           WHERE bound IS NOT NULL
          UNION ALL
          SELECT 'daytime', json_object('ideal', json('true'), 'weight', 1)
            FROM (SELECT json_extract(effect_json, '$.requireDaytime') AS required)
           WHERE required = 1
        )
      ))
    )
    WHERE json_extract(effect_json, '$.type') = 'weatherGate'
      AND json_extract(effect_json, '$.metrics') IS NULL;
  `,
};
