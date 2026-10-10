import { serve } from "@hono/node-server";
import { Database, TaskRepository } from "@mind-palace/database";
import { loadConfig } from "./config.js";
import { createHttpApp, type IntegrationRegistration } from "./http/app.js";
import { ScheduleService } from "./services/schedule-service.js";
import { WeatherService } from "./services/weather-service.js";
import { CalendarImportService } from "./services/calendar-import-service.js";
import { GarminService } from "./services/garmin-service.js";
import { RecurrenceService } from "./services/recurrence-service.js";

const config = loadConfig();
const database = new Database(config.databasePath);
database.migrate();
const tasks = new TaskRepository(database);
const schedule = new ScheduleService(tasks);
const weather = new WeatherService(tasks);
const calendar = new CalendarImportService(tasks);
const garmin = new GarminService(tasks);
const recurrence = new RecurrenceService(tasks);

// Enabling an integration is authenticating it: a provider reports `connected` only once its
// credential store exists, so this list is inert (and the UI stays clean) until then.
const integrationRegistry: IntegrationRegistration[] = [
  { key: "garmin", label: "Garmin Connect", status: () => garmin.status() },
];

const app = createHttpApp({ tasks, schedule, weather, calendar, garmin, integrationRegistry, recurrence });
const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  console.log(`Mind Palace API listening on http://${info.address}:${info.port}`);
});

function shutdown(): void {
  server.close();
  database.close();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);