import type { DatabaseSync } from "node:sqlite";
import type Postgrator from "postgrator";
import { inspectMigrations } from "./inspect-migrations.ts";

export async function migrateWorkspace(
  database: DatabaseSync,
  runner: Postgrator,
) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const status = await inspectMigrations(database, runner);
    await runner.migrate(String(status.targetVersion));
    const result = await inspectMigrations(database, runner);
    database.exec("COMMIT");
    return result;
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}
