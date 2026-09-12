import { Database } from "@opencode-task-manager/database";
import { loadConfig } from "./config.js";

const config = loadConfig();
const database = new Database(config.databasePath);
database.migrate();
database.close();
console.log(`Migrated ${config.databasePath}`);
