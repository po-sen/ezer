import type { DatabaseSync, SQLOutputValue } from "node:sqlite";
import {
  WorkspacePersistenceFault,
  type WorkspaceStore,
} from "../../../ports/outbound/index.ts";

type Row = Record<string, SQLOutputValue>;
function metadata(row: Row) {
  return {
    fileId: row.file_id as string,
    version: row.version as number,
    path: row.path as string,
    size: row.size as number,
    mediaType: row.media_type as string,
    deleted: row.deleted === 1,
    changedAt: row.changed_at as string,
    changeSequence: row.change_sequence as number,
  };
}
const columns =
  "r.file_id, r.version, r.path, length(r.content) AS size, r.media_type, r.deleted, r.changed_at, r.change_sequence";

export function createWorkspaceStore(
  database: DatabaseSync,
  active: () => boolean,
): WorkspaceStore {
  function prepare(sql: string) {
    if (!active()) throw new Error("Expired workspace transaction");
    return database.prepare(sql);
  }
  return {
    state() {
      const state = prepare(
        "SELECT individual_id, change_sequence FROM workspace_state WHERE singleton = 1",
      ).get();
      if (!state) throw new WorkspacePersistenceFault();
      return {
        individualId: state.individual_id as string,
        changeSequence: state.change_sequence as number,
      };
    },
    read(fileId, version) {
      const row =
        version === undefined
          ? prepare(
              "SELECT * FROM file_revisions WHERE file_id = ? ORDER BY version DESC LIMIT 1",
            ).get(fileId)
          : prepare(
              "SELECT * FROM file_revisions WHERE file_id = ? AND version = ?",
            ).get(fileId, version);
      return row
        ? { ...metadata(row), content: (row.content as Uint8Array).slice() }
        : null;
    },
    occupied(path, fileId) {
      return !!prepare(
        "SELECT 1 FROM file_heads WHERE deleted = 0 AND file_id <> ? AND (path = ? OR substr(path, 1, length(?) + 1) = ? || '/' OR substr(?, 1, length(path) + 1) = path || '/') LIMIT 1",
      ).get(fileId, path, path, path, path);
    },
    append(revision) {
      prepare("INSERT INTO file_revisions VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
        revision.fileId,
        revision.version,
        revision.path,
        revision.content,
        revision.mediaType,
        revision.deleted ? 1 : 0,
        revision.changedAt,
        revision.changeSequence,
      );
      prepare(
        "INSERT INTO file_heads VALUES (?, ?, ?, ?) ON CONFLICT(file_id) DO UPDATE SET version = excluded.version, path = excluded.path, deleted = excluded.deleted",
      ).run(
        revision.fileId,
        revision.version,
        revision.path,
        revision.deleted ? 1 : 0,
      );
      const updated = prepare(
        "UPDATE workspace_state SET change_sequence = ? WHERE singleton = 1 AND change_sequence = ?",
      ).run(revision.changeSequence, revision.changeSequence - 1);
      if (updated.changes !== 1) throw new WorkspacePersistenceFault();
    },
    list(snapshot, after, limit, deleted) {
      return prepare(
        `SELECT ${columns} FROM file_revisions r WHERE r.change_sequence <= ? AND r.change_sequence > ? AND r.deleted = ? AND NOT EXISTS (SELECT 1 FROM file_revisions newer WHERE newer.file_id = r.file_id AND newer.version > r.version AND newer.change_sequence <= ?) ORDER BY r.change_sequence LIMIT ?`,
      )
        .all(snapshot, after, deleted ? 1 : 0, snapshot, limit)
        .map(metadata);
    },
    history(fileId, before, limit) {
      return prepare(
        `SELECT ${columns} FROM file_revisions r WHERE r.file_id = ? AND (? IS NULL OR r.version < ?) ORDER BY r.version DESC LIMIT ?`,
      )
        .all(fileId, before, before, limit)
        .map(metadata);
    },
    receipt(operationId) {
      const row = prepare(
        "SELECT * FROM workspace_operations WHERE operation_id = ?",
      ).get(operationId);
      return row
        ? {
            fingerprint: row.fingerprint as string,
            fileId: row.file_id as string,
            version: row.version as number,
          }
        : null;
    },
    record(operationId, fingerprint, fileId, version) {
      prepare("INSERT INTO workspace_operations VALUES (?, ?, ?, ?)").run(
        operationId,
        fingerprint,
        fileId,
        version,
      );
    },
  };
}
