import { runner } from "node-pg-migrate";
import type pg from "pg";
import { join } from "node:path";
import { inspectMigrations } from "./inspect-migrations.ts";
import { readMigrationPlan } from "./read-migration-plan.ts";

const lockId = 1770131713; // Stable, context-owned lock within this database.

export async function migrateMemory(
  client: pg.Client,
  plan = readMigrationPlan(),
) {
  const { rows } = await client.query(
    "SELECT pg_try_advisory_lock($1) AS acquired",
    [lockId],
  );
  if (!rows[0]?.acquired)
    throw new Error("Memory migration is already running");
  try {
    await inspectMigrations(client, plan.names);
    await runner({
      dbClient: client,
      dir: join(plan.directory, "*.{sql,ts}"),
      useGlob: true,
      migrationLoaderStrategies: [{ extensions: [".sql"], loader: "sql" }],
      schema: "memory",
      createSchema: true,
      migrationsSchema: "memory",
      migrationsTable: "schema_migrations",
      direction: "up",
      singleTransaction: false,
      // The adapter holds the lock across both history validation and execution.
      noLock: true,
      checkOrder: true,
      logger: { info() {}, warn() {}, error() {} },
    });
    return await inspectMigrations(client, plan.names);
  } catch (error) {
    // The library's per-migration transaction may be aborted on failure.
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [lockId]);
  }
}
