import { serve } from "@hono/node-server";
import { homedir } from "node:os";
import { Database, OrchestrationRepository, TaskRepository } from "@opencode-task-manager/database";
import { loadConfig } from "./config.js";
import { createHttpApp } from "./http/app.js";
import { OpenCodeGateway } from "./services/opencode-gateway.js";
import { OpenCodeServer } from "./services/opencode-server.js";
import { Scheduler } from "./services/scheduler.js";
import { ScheduleService } from "./services/schedule-service.js";
import { WeatherService } from "./services/weather-service.js";
import { IntegrationService } from "./services/integration-service.js";
import { RecurrenceService } from "./services/recurrence-service.js";
import { TmuxManager } from "./services/tmux.js";

const config = loadConfig();
const database = new Database(config.databasePath);
database.migrate();
const repository = new OrchestrationRepository(database);
const tasks = new TaskRepository(database);
repository.ensureDefaultWorkspace("Home", homedir());
const openCodeServer = new OpenCodeServer(config, repository);

await openCodeServer.ensureRunning();
const tmux = new TmuxManager(config.tmuxSession, config.openCodeCommand, openCodeServer.endpoint);
const gateway = new OpenCodeGateway(openCodeServer, tmux, repository);
const scheduler = new Scheduler(config, repository, gateway);
const schedule = new ScheduleService(tasks);
const weather = new WeatherService(tasks);
const integrations = new IntegrationService(repository, tasks);
const recurrence = new RecurrenceService(repository, tasks);

gateway.startEventListener();
scheduler.start();

const app = createHttpApp({ repository, tasks, gateway, schedule, weather, integrations, recurrence });
const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  console.log(`OpenCode Task Manager API listening on http://${info.address}:${info.port}`);
});

function shutdown(): void {
  scheduler.stop();
  gateway.stopEventListener();
  server.close();
  openCodeServer.stop();
  database.close();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
