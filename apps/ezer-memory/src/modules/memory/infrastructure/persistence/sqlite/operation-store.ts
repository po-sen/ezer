import type { OperationStore } from "../../../ports/outbound/operation-store.ts";
import type { SqlSession } from "./session.ts";
export function createOperationStore(session: SqlSession): OperationStore {
  return {
    find(operationId) {
      const row = session.query<{
        fingerprint: string;
        memory_id: string;
        revision: number;
        recorded_at: string;
        change_sequence: number;
      }>(
        `SELECT o.fingerprint, r.memory_id, r.revision, r.recorded_at, r.change_sequence
         FROM operations o JOIN revisions r ON o.memory_id = r.memory_id AND o.revision = r.revision
         WHERE o.operation_id = ?`,
        operationId,
      )[0];
      return row
        ? {
            fingerprint: row.fingerprint,
            memoryId: row.memory_id,
            revision: row.revision,
            recordedAt: row.recorded_at,
            changeSequence: row.change_sequence,
          }
        : null;
    },
    record(operationId, operation) {
      session.query(
        "INSERT INTO operations (operation_id, fingerprint, memory_id, revision) VALUES (?, ?, ?, ?)",
        operationId,
        operation.fingerprint,
        operation.memoryId,
        operation.revision,
      );
    },
  };
}
