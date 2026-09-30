import { openDatabase } from "../modules/memory/infrastructure/persistence/postgresql/open-database.ts";
import { readMigrationPlan } from "../modules/memory/infrastructure/persistence/postgresql/read-migration-plan.ts";
import { inspectMigrations } from "../modules/memory/infrastructure/persistence/postgresql/inspect-migrations.ts";
import { migrateMemory } from "../modules/memory/infrastructure/persistence/postgresql/migrate-memory.ts";

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
