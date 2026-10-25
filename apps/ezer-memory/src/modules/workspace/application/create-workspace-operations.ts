import {
  WorkspaceFault,
  transitionFile,
  type FileRevision,
  type FileMetadata,
} from "../domain/index.ts";
import type {
  WorkspaceConnection,
  WorkspaceOperations,
  WorkspaceResult,
  WorkspaceFile,
} from "../ports/inbound/index.ts";
import {
  WorkspacePersistenceFault,
  type WorkspaceUnitOfWork,
  type WorkspaceStore,
  type WorkspaceFingerprint,
} from "../ports/outbound/index.ts";

function view(file: FileRevision | FileMetadata): WorkspaceFile {
  return {
    fileId: file.fileId,
    version: file.version,
    path: file.path,
    size: "content" in file ? file.content.byteLength : file.size,
    mediaType: file.mediaType,
    deleted: file.deleted,
    changedAt: file.changedAt,
    changeSequence: file.changeSequence,
  };
}
function integer(
  value: number,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new WorkspaceFault("INVALID_INPUT");
}
function id(value: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value))
    throw new WorkspaceFault("INVALID_INPUT");
}

export function createWorkspaceOperations(
  connection: WorkspaceConnection,
  unitOfWork: WorkspaceUnitOfWork,
  fingerprint: WorkspaceFingerprint,
  now: () => string,
): WorkspaceOperations {
  const individualId = connection.individualId;
  const read = connection.capabilities.read;
  const write = connection.capabilities.write;
  function perform<T>(
    allowed: boolean,
    denial: "READ_NOT_GRANTED" | "WRITE_NOT_GRANTED",
    work: (store: WorkspaceStore) => T extends PromiseLike<unknown> ? never : T,
  ): WorkspaceResult<T> {
    if (!allowed) return { ok: false, code: denial };
    try {
      const value = unitOfWork.within<T>((store) => {
        if (store.state().individualId !== individualId)
          throw new WorkspacePersistenceFault();
        return work(store);
      });
      return { ok: true, value };
    } catch (error) {
      if (error instanceof WorkspaceFault)
        return { ok: false, code: error.code };
      if (error instanceof WorkspacePersistenceFault)
        return { ok: false, code: "UNAVAILABLE" };
      throw error;
    }
  }
  return {
    async mutate(input) {
      if (!write) return { ok: false, code: "WRITE_NOT_GRANTED" };
      try {
        id(input.operationId);
        id(input.fileId);
        integer(input.expectedVersion, 0, Number.MAX_SAFE_INTEGER - 1);
        if (input.kind === "restore") integer(input.version, 1);
        if (
          input.kind === "write" &&
          (!(input.content instanceof Uint8Array) ||
            input.content.byteLength > 1_048_576)
        )
          throw new WorkspaceFault("INVALID_INPUT");
        const command =
          input.kind === "write"
            ? { ...input, content: input.content.slice() }
            : { ...input };
        // Fixed field order and a byte snapshot make retries independent of caller mutation.
        const digest = await fingerprint.digest(
          JSON.stringify({
            kind: command.kind,
            fileId: command.fileId,
            expectedVersion: command.expectedVersion,
            path: "path" in command ? command.path : null,
            version: command.kind === "restore" ? command.version : null,
            mediaType: command.kind === "write" ? command.mediaType : null,
          }),
          command.kind === "write" ? command.content : undefined,
        );
        return perform(write, "WRITE_NOT_GRANTED", (store) => {
          const receipt = store.receipt(command.operationId);
          if (receipt) {
            if (receipt.fingerprint !== digest)
              throw new WorkspaceFault("OPERATION_CONFLICT");
            const revision = store.read(receipt.fileId, receipt.version);
            if (!revision) throw new WorkspacePersistenceFault();
            return view(revision);
          }
          const current = store.read(command.fileId);
          const previous =
            command.kind === "restore"
              ? store.read(command.fileId, command.version)
              : null;
          const revision = transitionFile(
            current,
            command,
            previous,
            store.state().changeSequence + 1,
            now(),
          );
          if (
            !revision.deleted &&
            store.occupied(revision.path, revision.fileId)
          )
            throw new WorkspaceFault("PATH_OCCUPIED");
          store.append(revision);
          store.record(
            command.operationId,
            digest,
            revision.fileId,
            revision.version,
          );
          return view(revision);
        });
      } catch (error) {
        if (error instanceof WorkspaceFault)
          return { ok: false, code: error.code };
        if (error instanceof WorkspacePersistenceFault)
          return { ok: false, code: "UNAVAILABLE" };
        throw error;
      }
    },
    read(query) {
      return perform(read, "READ_NOT_GRANTED", (store) => {
        id(query.fileId);
        if (query.version !== undefined) integer(query.version, 1);
        const offset = query.offset ?? 0;
        const length = query.length ?? 65_536;
        integer(offset, 0, 1_048_576);
        integer(length, 1, 65_536);
        const file = store.read(query.fileId, query.version);
        if (!file || (query.version === undefined && file.deleted))
          throw new WorkspaceFault("NOT_FOUND");
        if (offset > file.content.byteLength)
          throw new WorkspaceFault("INVALID_INPUT");
        const end = Math.min(offset + length, file.content.byteLength);
        return {
          file: view(file),
          content: file.content.slice(offset, end),
          nextOffset: end < file.content.byteLength ? end : null,
        };
      });
    },
    list(query) {
      return perform(read, "READ_NOT_GRANTED", (store) => {
        const limit = query.limit ?? 20;
        integer(limit, 1, 50);
        const state = store.state();
        const snapshot = query.cursor?.snapshotSequence ?? state.changeSequence;
        const after = query.cursor?.afterSequence ?? 0;
        const deleted = query.deleted ?? query.cursor?.deleted ?? false;
        integer(snapshot, 0, state.changeSequence);
        integer(after, 0, snapshot);
        if (query.cursor && query.cursor.deleted !== deleted)
          throw new WorkspaceFault("INVALID_INPUT");
        const files = store.list(snapshot, after, limit + 1, deleted);
        const page = files.slice(0, limit);
        return {
          files: page.map(view),
          nextCursor:
            files.length > limit
              ? {
                  snapshotSequence: snapshot,
                  afterSequence: page.at(-1)!.changeSequence,
                  deleted,
                }
              : null,
        };
      });
    },
    history(query) {
      return perform(read, "READ_NOT_GRANTED", (store) => {
        id(query.fileId);
        const limit = query.limit ?? 20;
        integer(limit, 1, 50);
        const before = query.beforeVersion ?? null;
        if (before !== null) integer(before, 1);
        const files = store.history(query.fileId, before, limit + 1);
        const page = files.slice(0, limit);
        return {
          files: page.map(view),
          nextBeforeVersion: files.length > limit ? page.at(-1)!.version : null,
        };
      });
    },
  };
}
