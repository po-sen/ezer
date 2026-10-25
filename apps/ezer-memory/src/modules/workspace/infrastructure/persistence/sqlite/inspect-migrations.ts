import type { DatabaseSync } from "node:sqlite";
import type Postgrator from "postgrator";

export async function inspectMigrations(
  database: DatabaseSync,
  runner: Postgrator,
) {
  const targetVersion = await runner.getMaxVersion();
  const currentVersion = await runner.getDatabaseVersion();
  if (currentVersion > targetVersion)
    throw new Error("Unsupported workspace schema version");
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
      throw new Error("Invalid workspace migration history");
    await runner.validateMigrations(currentVersion);
  } else if (
    database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      )
      .get()
  )
    throw new Error("Workspace schema has no migration history");
  return {
    currentVersion,
    targetVersion,
    pending: targetVersion - currentVersion,
  };
}
