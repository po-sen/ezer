import type { MemoryRevision, MemoryState } from "../domain/memory";
import type {
  MemoryStore,
  MemoryTransaction,
} from "../outboundport/memory-store";

interface RevisionRow extends Record<string, string | number | null> {
  memory_id: string;
  revision: number;
  body: string;
  source_reference: string;
  source_excerpt: string;
  reason: string | null;
  recorded_at: string;
  change_sequence: number;
}

export function createSqliteMemoryStore(
  storage: DurableObjectStorage,
): MemoryStore {
  const sql = storage.sql;
  const state = (): MemoryState => {
    const row = sql
      .exec<{ individual_id: string; change_sequence: number }>(
        "SELECT individual_id, change_sequence FROM memory_state WHERE singleton = 1",
      )
      .one();
    return {
      individualId: row.individual_id,
      changeSequence: row.change_sequence,
    };
  };
  const transaction: MemoryTransaction = {
    state,
    findRevision(memoryId, revision) {
      const rows =
        revision === undefined
          ? sql
              .exec<RevisionRow>(
                "SELECT * FROM memory_revisions WHERE memory_id = ? ORDER BY revision DESC LIMIT 1",
                memoryId,
              )
              .toArray()
          : sql
              .exec<RevisionRow>(
                "SELECT * FROM memory_revisions WHERE memory_id = ? AND revision = ?",
                memoryId,
                revision,
              )
              .toArray();
      const row = rows[0];
      if (!row) return null;
      return {
        individualId: state().individualId,
        memoryId: row.memory_id,
        revision: row.revision,
        body: row.body,
        source: {
          reference: row.source_reference,
          excerpt: row.source_excerpt,
        },
        reason: row.reason,
        recordedAt: row.recorded_at,
        changeSequence: row.change_sequence,
      };
    },
    findOperation(operationId) {
      const row = sql
        .exec<{
          fingerprint: string;
          memory_id: string;
          revision: number;
          recorded_at: string;
          change_sequence: number;
        }>(
          `
        SELECT o.fingerprint, r.memory_id, r.revision, r.recorded_at, r.change_sequence
        FROM memory_operations o JOIN memory_revisions r
        ON o.memory_id = r.memory_id AND o.revision = r.revision
        WHERE o.operation_id = ?
      `,
          operationId,
        )
        .toArray()[0];
      if (!row) return null;
      return {
        fingerprint: row.fingerprint,
        receipt: {
          individualId: state().individualId,
          memoryId: row.memory_id,
          revision: row.revision,
          changeSequence: row.change_sequence,
          recordedAt: row.recorded_at,
        },
      };
    },
    appendRevision(revision: MemoryRevision) {
      sql.exec(
        `
        INSERT INTO memory_revisions
          (memory_id, revision, body, source_reference, source_excerpt, reason, recorded_at, change_sequence)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
        revision.memoryId,
        revision.revision,
        revision.body,
        revision.source.reference,
        revision.source.excerpt,
        revision.reason,
        revision.recordedAt,
        revision.changeSequence,
      );
      sql.exec(
        "UPDATE memory_state SET change_sequence = ? WHERE singleton = 1",
        revision.changeSequence,
      );
    },
    recordOperation(operationId, operation) {
      sql.exec(
        "INSERT INTO memory_operations (operation_id, fingerprint, memory_id, revision) VALUES (?, ?, ?, ?)",
        operationId,
        operation.fingerprint,
        operation.receipt.memoryId,
        operation.receipt.revision,
      );
    },
  };
  return {
    transaction: (work) => storage.transactionSync(() => work(transaction)),
  };
}
