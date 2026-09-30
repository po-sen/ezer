import type { IndividualStateStore } from "../../../ports/outbound/individual-state-store.ts";
import { PersistenceFault } from "../../../ports/outbound/persistence-fault.ts";
import type { SqlSession } from "./session.ts";
export function createIndividualStateStore(
  session: SqlSession,
): IndividualStateStore {
  return {
    read() {
      const row = session.query<{
        individual_id: string;
        change_sequence: number;
      }>(
        "SELECT individual_id, change_sequence FROM state WHERE singleton = 1",
      )[0];
      if (!row) throw new PersistenceFault();
      return {
        individualId: row.individual_id,
        changeSequence: row.change_sequence,
      };
    },
    advance(expectedSequence, nextSequence) {
      if (
        nextSequence !== expectedSequence + 1 ||
        !Number.isSafeInteger(nextSequence)
      )
        throw new Error("Invalid sequence transition");
      const rows = session.query(
        `UPDATE state SET change_sequence = ? WHERE singleton = 1 AND change_sequence = ? RETURNING change_sequence`,
        nextSequence,
        expectedSequence,
      );
      if (rows.length !== 1) throw new PersistenceFault();
    },
  };
}
