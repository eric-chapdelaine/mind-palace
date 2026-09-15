import { initialMigration } from "./001-initial.js";
import { exampleTagsMigration } from "./002-example-tags.js";
import { removeTaskParentMigration } from "./003-remove-task-parent.js";
import { thisWeekTagsMigration } from "./004-this-week-tags.js";

export interface Migration {
  version: number;
  name: string;
  sql: string;
  /** True only for schema rewrites that must drop/recreate tables with live foreign keys (e.g. column removal). */
  foreignKeysOff?: boolean;
}

export const migrations: Migration[] = [
  initialMigration,
  exampleTagsMigration,
  removeTaskParentMigration,
  thisWeekTagsMigration,
];