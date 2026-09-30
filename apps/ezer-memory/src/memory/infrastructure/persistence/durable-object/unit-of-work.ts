import { PersistenceFault } from "../../../outboundport/persistence-fault";
import type { UnitOfWork } from "../../../outboundport/unit-of-work";
import { createIndividualStateStore } from "./individual-state-store";
import { createOperationStore } from "./operation-store";
import { createRevisionStore } from "./revision-store";
import { createSqlSession } from "./session";
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
