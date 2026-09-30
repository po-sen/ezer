import {
  openDatabase,
  createMigrationRunner,
  inspectMigrations,
  migrateMemory,
} from "../../modules/memory/infrastructure/persistence/sqlite/cli/index.ts";

export function createSqliteMigrator(path: string, readOnly: boolean) {
  const database = openDatabase(path, readOnly);
  // Load/validate artifacts on invocation so the caller can always close the handle.
  return {
    status: () => inspectMigrations(database, createMigrationRunner(database)),
    up: () => migrateMemory(database, createMigrationRunner(database)),
    close: () => database.close(),
  };
}
