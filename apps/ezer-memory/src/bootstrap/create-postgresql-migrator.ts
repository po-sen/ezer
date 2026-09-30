import {
  openDatabase,
  readMigrationPlan,
  inspectMigrations,
  migrateMemory,
} from "../modules/memory/infrastructure/persistence/postgresql/index.ts";

export function createPostgresqlMigrator(
  options: Parameters<typeof openDatabase>[0],
) {
  const client = openDatabase(options);
  return {
    connect: () => client.connect(),
    status: () => inspectMigrations(client, readMigrationPlan().names),
    up: () => migrateMemory(client),
    close: () => client.end(),
  };
}
