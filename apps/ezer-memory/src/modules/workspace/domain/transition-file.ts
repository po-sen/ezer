import type { FileRevision } from "./file-revision.ts";
import type { FileChange } from "./file-change.ts";
import { validateFilePath } from "./validate-file-path.ts";
import { WorkspaceFault } from "./workspace-fault.ts";

export function transitionFile(
  current: FileRevision | null,
  command: FileChange,
  previous: FileRevision | null,
  changeSequence: number,
  changedAt: string,
): FileRevision {
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(command.fileId) ||
    !Number.isSafeInteger(command.expectedVersion) ||
    command.expectedVersion < 0 ||
    command.expectedVersion >= Number.MAX_SAFE_INTEGER ||
    !Number.isSafeInteger(changeSequence) ||
    changeSequence < 1
  )
    throw new WorkspaceFault("INVALID_INPUT");
  if ((current?.version ?? 0) !== command.expectedVersion)
    throw new WorkspaceFault("VERSION_CONFLICT");
  if (!current && command.kind !== "write")
    throw new WorkspaceFault("NOT_FOUND");
  if (current?.deleted && command.kind !== "restore")
    throw new WorkspaceFault("NOT_FOUND");
  if (
    command.kind === "restore" &&
    (!previous ||
      previous.deleted ||
      previous.fileId !== command.fileId ||
      previous.version !== command.version ||
      previous.version > current!.version)
  )
    throw new WorkspaceFault("NOT_FOUND");
  const source = command.kind === "restore" ? previous! : current;
  const path = ("path" in command ? command.path : undefined) ?? source!.path;
  validateFilePath(path);
  const content = command.kind === "write" ? command.content : source!.content;
  const mediaType =
    command.kind === "write" ? command.mediaType : source!.mediaType;
  if (
    !(content instanceof Uint8Array) ||
    content.byteLength > 1_048_576 ||
    !/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(mediaType) ||
    mediaType.length > 200
  )
    throw new WorkspaceFault("INVALID_INPUT");
  return {
    fileId: command.fileId,
    version: command.expectedVersion + 1,
    path,
    content: content.slice(),
    mediaType,
    deleted: command.kind === "trash",
    changedAt,
    changeSequence,
  };
}
