import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrations } from "./migrations/index.js";

export class Database {
  readonly connection: DatabaseSync;

  constructor(path: string) {
    const resolvedPath = resolve(path);
    mkdirSync(dirname(resolvedPath), { recursive: true });
    this.connection = new DatabaseSync(resolvedPath);
    this.connection.exec("PRAGMA foreign_keys = ON;");
    this.connection.exec("PRAGMA journal_mode = WAL;");
    this.connection.exec("PRAGMA busy_timeout = 5000;");
  }

  migrate(): void {
    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);

    const applied = new Set(
      this.connection
        .prepare("SELECT version FROM schema_migrations")
        .all()
        .map((row) => Number(row.version)),
    );
    const insert = this.connection.prepare(
      "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
    );

    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;

      this.connection.exec("BEGIN IMMEDIATE");
      try {
        this.connection.exec(migration.sql);
        insert.run(migration.version, migration.name, new Date().toISOString());
        this.connection.exec("COMMIT");
      } catch (error) {
        this.connection.exec("ROLLBACK");
        throw error;
      }
    }
  }

  close(): void {
    this.connection.close();
  }
}
