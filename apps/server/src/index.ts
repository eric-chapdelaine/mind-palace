import { serve } from "@hono/node-server";
import { Database, TaskRepository } from "@mind-palace/database";
import { loadConfig } from "./config.js";
import { createHttpApp } from "./http/app.js";
import { ScheduleService } from "./services/schedule-service.js";
import { WeatherService } from "./services/weather-service.js";
import { IntegrationService } from "./services/integration-service.js";
import { RecurrenceService } from "./services/recurrence-service.js";

const config = loadConfig();
const database = new Database(config.databasePath);
database.migrate();
const tasks = new TaskRepository(database);
const schedule = new ScheduleService(tasks);
const weather = new WeatherService(tasks);
const integrations = new IntegrationService(tasks);
const recurrence = new RecurrenceService(tasks);

const app = createHttpApp({ tasks, schedule, weather, integrations, recurrence });
const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  console.log(`Mind Palace API listening on http://${info.address}:${info.port}`);
});

function shutdown(): void {
  server.close();
  database.close();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);