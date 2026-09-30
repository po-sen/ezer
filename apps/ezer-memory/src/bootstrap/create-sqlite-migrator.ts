import { openDatabase } from "../modules/memory/infrastructure/persistence/sqlite/open-database.ts";
import { createMigrationRunner } from "../modules/memory/infrastructure/persistence/sqlite/create-migration-runner.ts";
import { inspectMigrations } from "../modules/memory/infrastructure/persistence/sqlite/inspect-migrations.ts";
import { migrateMemory } from "../modules/memory/infrastructure/persistence/sqlite/migrate-memory.ts";

export function createSqliteMigrator(path: string, readOnly: boolean) {
  const database = openDatabase(path, readOnly);
  // Load/validate artifacts on invocation so the caller can always close the handle.
  return {
    status: () => inspectMigrations(database, createMigrationRunner(database)),
    up: () => migrateMemory(database, createMigrationRunner(database)),
    close: () => database.close(),
  };
}
