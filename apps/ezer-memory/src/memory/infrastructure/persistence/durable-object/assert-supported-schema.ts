import type { SqlSession } from "./session";

export function assertSupportedSchema(session: SqlSession): void {
  // Old, unpublished PR databases are not an upgrade source. Never overwrite them.
  if (
    session.query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_schema'",
    ).length
  ) {
    throw new Error("Unreleased memory schema requires explicit reset");
  }
}
