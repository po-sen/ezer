import type { DatabaseSync } from "node:sqlite";
import type Postgrator from "postgrator";

export async function inspectMigrations(
  database: DatabaseSync,
  runner: Postgrator,
) {
  if (
    database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_schema'",
      )
      .get()
  )
    throw new Error("Unreleased SQLite schema is not an upgrade source");
  const targetVersion = await runner.getMaxVersion();
  const currentVersion = await runner.getDatabaseVersion();
  if (currentVersion > targetVersion)
    throw new Error("Unsupported SQLite schema version");
  const ledger = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
    )
    .get();
  if (ledger) {
    const rows = database
      .prepare("SELECT version, md5 FROM schema_migrations ORDER BY version")
      .all();
    if (
      rows.length !== currentVersion + 1 ||
      rows.some(
        (row, index) =>
          row.version !== index || (index > 0 && typeof row.md5 !== "string"),
      )
    )
      throw new Error("Invalid SQLite migration history");
    await runner.validateMigrations(currentVersion);
  } else if (
    database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('state', 'revisions', 'operations')",
      )
      .get()
  ) {
    throw new Error("SQLite schema has no migration history");
  }
  return {
    currentVersion,
    targetVersion,
    pending: targetVersion - currentVersion,
  };
}
