import {
  SQLSchemaMigrations,
  type SQLSchemaMigration,
} from "durable-utils/sql-migrations";
import { assertSupportedSchema } from "./assert-supported-schema.ts";
import { migrations } from "./migrations/migrations.generated.ts";
import { createSqlSession } from "./create-sql-session.ts";
const ledgerKey = "memory:schema-version";

export function migrateMemory(
  storage: DurableObjectStorage,
  plan: readonly SQLSchemaMigration[] = migrations,
): void {
  assertSupportedSchema(createSqlSession(storage.sql, () => true));
  const last = storage.kv.get<number>(ledgerKey);
  if (
    last !== undefined &&
    (!Number.isSafeInteger(last) ||
      !plan.some((migration) => migration.idMonotonicInc === last))
  ) {
    throw new Error("Unsupported memory schema version");
  }
  // The library alone executes pending SQL and atomically updates its KV ledger.
  // Use a fresh runner on each attempt; never retain progress from a failed run.
  new SQLSchemaMigrations({
    doStorage: storage,
    migrations: [...plan],
    keyNameTrackingLastMigrationID: ledgerKey,
  }).runAllSync();
}
