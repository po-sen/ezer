import type { RestoreStore } from "../../../ports/outbound/index.ts";
import { PersistenceFault } from "../../../ports/outbound/index.ts";
import type { SqlSession } from "./session.ts";
export function createRestoreStore(session: SqlSession): RestoreStore {
  return {
    read() {
      const row = session.query<{
        restore_id: string;
        snapshot_sequence: number;
        complete: number;
      }>(
        "SELECT restore_id, snapshot_sequence, complete FROM restore WHERE singleton = 1",
      )[0];
      return row
        ? {
            restoreId: row.restore_id,
            snapshotSequence: row.snapshot_sequence,
            complete: row.complete === 1,
          }
        : null;
    },
    start(restoreId, snapshotSequence) {
      session.query(
        "INSERT INTO restore (singleton, restore_id, snapshot_sequence, complete) VALUES (1, ?, ?, 0)",
        restoreId,
        snapshotSequence,
      );
    },
    complete() {
      if (
        session.query(
          "UPDATE restore SET complete = 1 WHERE singleton = 1 AND complete = 0 RETURNING singleton",
        ).length !== 1
      )
        throw new PersistenceFault();
    },
  };
}
