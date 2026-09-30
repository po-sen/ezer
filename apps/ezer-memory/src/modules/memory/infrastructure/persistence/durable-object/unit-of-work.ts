import { PersistenceFault } from "../../../ports/outbound/persistence-fault.ts";
import type { UnitOfWork } from "../../../ports/outbound/unit-of-work.ts";
import { createIndividualStateStore } from "./individual-state-store.ts";
import { createOperationStore } from "./operation-store.ts";
import { createRevisionStore } from "./revision-store.ts";
import { createSqlSession } from "./create-sql-session.ts";
export function createDurableObjectUnitOfWork(
  storage: DurableObjectStorage,
): UnitOfWork {
  let active = false;
  return {
    within(work) {
      if (active) throw new Error("Nested memory Unit of Work is forbidden");
      let callbackFailed = false;
      try {
        return storage.transactionSync(() => {
          active = true;
          let scopeActive = true;
          const session = createSqlSession(storage.sql, () => scopeActive);
          try {
            const result = work({
              state: createIndividualStateStore(session),
              revisions: createRevisionStore(session),
              operations: createOperationStore(session),
            });
            if (
              result !== null &&
              (typeof result === "object" || typeof result === "function") &&
              "then" in result
            ) {
              throw new Error("Memory Unit of Work must be synchronous");
            }
            return result;
          } catch (error) {
            callbackFailed = true;
            throw error;
          } finally {
            scopeActive = false;
            active = false;
          }
        });
      } catch (error) {
        if (callbackFailed) throw error;
        throw new PersistenceFault();
      }
    },
  };
}
