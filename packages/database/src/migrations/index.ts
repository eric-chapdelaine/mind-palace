import { initialMigration } from "./001-initial.js";
import { exampleTagsMigration } from "./002-example-tags.js";

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const migrations: Migration[] = [
  initialMigration,
  exampleTagsMigration,
];