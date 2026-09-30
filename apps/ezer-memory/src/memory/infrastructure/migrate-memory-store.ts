export function migrateMemoryStore(
  storage: DurableObjectStorage,
  individualId: string,
): void {
  storage.transactionSync(() => {
    const sql = storage.sql;
    sql.exec(
      "CREATE TABLE IF NOT EXISTS memory_schema (version INTEGER PRIMARY KEY)",
    );
    const versions = sql
      .exec<{ version: number }>("SELECT version FROM memory_schema")
      .toArray();
    if (
      versions.length > 1 ||
      (versions.length === 1 && versions[0]!.version !== 1)
    ) {
      throw new Error("Unsupported memory schema version");
    }
    if (versions.length === 0) {
      sql.exec(`
        CREATE TABLE memory_state (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          individual_id TEXT NOT NULL,
          change_sequence INTEGER NOT NULL CHECK (change_sequence >= 0)
        );
        CREATE TABLE memory_revisions (
          memory_id TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision > 0),
          body TEXT NOT NULL,
          source_reference TEXT NOT NULL,
          source_excerpt TEXT NOT NULL,
          reason TEXT,
          recorded_at TEXT NOT NULL,
          change_sequence INTEGER NOT NULL UNIQUE CHECK (change_sequence > 0),
          PRIMARY KEY (memory_id, revision),
          CHECK ((revision = 1 AND reason IS NULL) OR (revision > 1 AND reason IS NOT NULL))
        );
        CREATE TABLE memory_operations (
          operation_id TEXT PRIMARY KEY,
          fingerprint TEXT NOT NULL,
          memory_id TEXT NOT NULL,
          revision INTEGER NOT NULL,
          FOREIGN KEY (memory_id, revision) REFERENCES memory_revisions(memory_id, revision)
        );
        INSERT INTO memory_schema (version) VALUES (1);
      `);
      sql.exec("INSERT INTO memory_state VALUES (1, ?, 0)", individualId);
    }
    const state = sql
      .exec<{ individual_id: string }>(
        "SELECT individual_id FROM memory_state WHERE singleton = 1",
      )
      .one();
    if (state.individual_id !== individualId)
      throw new Error("Memory store identity mismatch");
  });
}
