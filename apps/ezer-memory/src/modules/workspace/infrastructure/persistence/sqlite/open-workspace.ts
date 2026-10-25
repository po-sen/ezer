import { DatabaseSync } from "node:sqlite";
import { createMigrationRunner } from "./create-migration-runner.ts";
import { inspectMigrations } from "./inspect-migrations.ts";
import { migrateWorkspace } from "./migrate-workspace.ts";
import { createWorkspaceUnitOfWork } from "./unit-of-work.ts";

export function openWorkspace(
  path: string,
  directory: string,
  readOnly = false,
) {
  const database = new DatabaseSync(path, { readOnly });
  try {
    database.exec(
      "PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL;",
    );
  } catch (error) {
    database.close();
    throw error;
  }
  return {
    unitOfWork: createWorkspaceUnitOfWork(database),
    status: () =>
      inspectMigrations(database, createMigrationRunner(database, directory)),
    up: () =>
      migrateWorkspace(database, createMigrationRunner(database, directory)),
    initialize(individualId: string) {
      database.exec("BEGIN IMMEDIATE");
      try {
        database
          .prepare(
            "INSERT INTO workspace_state VALUES (1, ?, 0) ON CONFLICT(singleton) DO NOTHING",
          )
          .run(individualId);
        const state = database
          .prepare(
            "SELECT individual_id FROM workspace_state WHERE singleton = 1",
          )
          .get();
        if (state?.individual_id !== individualId)
          throw new Error("Workspace identity mismatch");
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
    close: () => database.close(),
  };
}
