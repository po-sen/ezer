import type { DatabaseSync } from "node:sqlite";
import {
  WorkspacePersistenceFault,
  type WorkspaceUnitOfWork,
  type WorkspaceStore,
} from "../../../ports/outbound/index.ts";
import { createWorkspaceStore } from "./create-workspace-store.ts";

export function createWorkspaceUnitOfWork(
  database: DatabaseSync,
): WorkspaceUnitOfWork {
  let active = false;
  return {
    within(work) {
      if (active) throw new Error("Nested workspace Unit of Work is forbidden");
      let scopeActive = true;
      let callbackFailed = false;
      try {
        database.exec("BEGIN IMMEDIATE");
        active = true;
        const store = createWorkspaceStore(database, () => scopeActive);
        const guarded = new Proxy(store, {
          get(target, key: keyof WorkspaceStore) {
            return (...args: never[]) => {
              if (!scopeActive)
                throw new Error("Expired workspace transaction");
              try {
                return (target[key] as (...args: never[]) => unknown)(...args);
              } catch {
                throw new WorkspacePersistenceFault();
              }
            };
          },
        });
        let result;
        try {
          result = work(guarded);
          if (
            result !== null &&
            (typeof result === "object" || typeof result === "function") &&
            "then" in result
          )
            throw new Error("Workspace Unit of Work must be synchronous");
        } catch (error) {
          callbackFailed = true;
          throw error;
        }
        database.exec("COMMIT");
        return result;
      } catch (error) {
        if (database.isTransaction) database.exec("ROLLBACK");
        if (callbackFailed) throw error;
        throw new WorkspacePersistenceFault();
      } finally {
        active = false;
        scopeActive = false;
      }
    },
  };
}
