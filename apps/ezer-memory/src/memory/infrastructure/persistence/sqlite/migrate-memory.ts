import {
  SQLSchemaMigrations,
  type SQLSchemaMigration,
} from "durable-utils/sql-migrations";
import { migrations } from "../migrations/generated";
const ledgerKey = "memory:schema-version";

export function migrateMemory(
  storage: DurableObjectStorage,
  plan: readonly SQLSchemaMigration[] = migrations,
): void {
  // Old, unpublished PR databases are not an upgrade source. Never overwrite them.
  if (
    storage.sql
      .exec(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_schema'",
      )
      .toArray().length
  ) {
    throw new Error("Unreleased memory schema requires explicit reset");
  }
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
