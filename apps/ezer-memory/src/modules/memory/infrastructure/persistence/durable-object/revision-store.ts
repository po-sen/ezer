import type { RevisionStore } from "../../../ports/outbound/index.ts";
import type { SqlSession } from "./session.ts";
import type { SqlValue } from "./sql-value.ts";
interface RevisionRow extends Record<string, SqlValue> {
  memory_id: string;
  revision: number;
  body: string;
  source_reference: string;
  source_excerpt: string;
  reason: string | null;
  recorded_at: string;
  change_sequence: number;
}
export function createRevisionStore(session: SqlSession): RevisionStore {
  return {
    find(memoryId, revision) {
      const row = (
        revision === undefined
          ? session.query<RevisionRow>(
              "SELECT * FROM revisions WHERE memory_id = ? ORDER BY revision DESC LIMIT 1",
              memoryId,
            )
          : session.query<RevisionRow>(
              "SELECT * FROM revisions WHERE memory_id = ? AND revision = ?",
              memoryId,
              revision,
            )
      )[0];
      return row
        ? Object.freeze({
            memoryId: row.memory_id,
            revision: row.revision,
            body: row.body,
            source: Object.freeze({
              reference: row.source_reference,
              excerpt: row.source_excerpt,
            }),
            reason: row.reason,
            recordedAt: row.recorded_at,
            changeSequence: row.change_sequence,
          })
        : null;
    },
    append(revision) {
      session.query(
        `INSERT INTO revisions
        (memory_id, revision, body, source_reference, source_excerpt, reason, recorded_at, change_sequence)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        revision.memoryId,
        revision.revision,
        revision.body,
        revision.source.reference,
        revision.source.excerpt,
        revision.reason,
        revision.recordedAt,
        revision.changeSequence,
      );
    },
  };
}
