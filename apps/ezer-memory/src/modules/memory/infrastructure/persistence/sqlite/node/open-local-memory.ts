import { DatabaseSync } from "node:sqlite";
import { initializeIndividual, type SqlSession } from "../index.ts";
import { createSqliteUnitOfWork } from "./unit-of-work.ts";

export function openLocalMemory(path: string, individualId: string) {
  const database = new DatabaseSync(path);
  try {
    database.exec(
      "PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL;",
    );
  } catch (error) {
    database.close();
    throw error;
  }
  return {
    database,
    unitOfWork: createSqliteUnitOfWork(database),
    initialize() {
      const session: SqlSession = {
        query(sql, ...bindings) {
          return database
            .prepare(sql)
            .all(
              ...bindings.map((value) =>
                value instanceof ArrayBuffer ? new Uint8Array(value) : value,
              ),
            ) as never;
        },
      };
      initializeIndividual(session, individualId);
    },
    close: () => database.close(),
  };
}
