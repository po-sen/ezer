import type pg from "pg";

export async function inspectMigrations(
  client: pg.Client,
  names: readonly string[],
) {
  const { rows: tables } = await client.query(
    "SELECT to_regclass('memory.schema_migrations') AS ledger",
  );
  const applied: string[] = [];
  if (tables[0]?.ledger) {
    const { rows } = await client.query(
      "SELECT name FROM memory.schema_migrations ORDER BY id",
    );
    applied.push(...rows.map((row: { name: string }) => row.name));
  } else {
    const { rows } = await client.query(
      "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'memory' AND tablename IN ('state', 'revisions', 'operations', 'memory_schema')",
    );
    if (rows.length)
      throw new Error("PostgreSQL schema has no migration history");
  }
  if (applied.some((name, index) => name !== names[index]))
    throw new Error("Unsupported PostgreSQL migration history");
  return {
    currentVersion: applied.length,
    targetVersion: names.length,
    pending: names.length - applied.length,
  };
}
