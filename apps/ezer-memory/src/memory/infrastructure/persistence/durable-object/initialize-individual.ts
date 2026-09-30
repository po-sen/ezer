import { initializeIndividual as initializeSqliteIndividual } from "../sqlite/initialize-individual";
import { createSqlSession } from "./session";

export function initializeIndividual(
  storage: DurableObjectStorage,
  individualId: string,
): void {
  storage.transactionSync(() => {
    let active = true;
    try {
      initializeSqliteIndividual(
        createSqlSession(storage.sql, () => active),
        individualId,
      );
    } finally {
      active = false;
    }
  });
}
