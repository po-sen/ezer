import type { DatabaseSync } from "node:sqlite";
import {
  PersistenceFault,
  type UnitOfWork,
} from "../../../../ports/outbound/index.ts";
import {
  createIndividualStateStore,
  createOperationStore,
  createRevisionStore,
  createRestoreStore,
  type SqlSession,
} from "../index.ts";

export function createSqliteUnitOfWork(database: DatabaseSync): UnitOfWork {
  let active = false;
  return {
    within(work) {
      if (active) throw new Error("Nested memory Unit of Work is forbidden");
      let scopeActive = true;
      let callbackFailed = false;
      try {
        database.exec("BEGIN IMMEDIATE");
        active = true;
        const session: SqlSession = {
          query(sql, ...bindings) {
            if (!scopeActive) throw new Error("Expired memory transaction");
            try {
              return database
                .prepare(sql)
                .all(
                  ...bindings.map((value) =>
                    value instanceof ArrayBuffer
                      ? new Uint8Array(value)
                      : value,
                  ),
                ) as never;
            } catch {
              throw new PersistenceFault();
            }
          },
        };
        let result;
        try {
          result = work({
            state: createIndividualStateStore(session),
            operations: createOperationStore(session),
            revisions: createRevisionStore(session),
            restore: createRestoreStore(session),
          });
          if (
            result !== null &&
            (typeof result === "object" || typeof result === "function") &&
            "then" in result
          )
            throw new Error("Memory Unit of Work must be synchronous");
        } catch (error) {
          callbackFailed = true;
          throw error;
        }
        database.exec("COMMIT");
        return result;
      } catch (error) {
        if (database.isTransaction) database.exec("ROLLBACK");
        if (callbackFailed) throw error;
        throw new PersistenceFault();
      } finally {
        active = false;
        scopeActive = false;
      }
    },
  };
}
