import type { FileRevision, FileMetadata } from "../../domain/index.ts";

export interface WorkspaceStore {
  state(): { readonly individualId: string; readonly changeSequence: number };
  read(fileId: string, version?: number): FileRevision | null;
  occupied(path: string, fileId: string): boolean;
  append(revision: FileRevision): void;
  list(
    snapshot: number,
    after: number,
    limit: number,
    deleted: boolean,
  ): FileMetadata[];
  history(fileId: string, before: number | null, limit: number): FileMetadata[];
  receipt(operationId: string): {
    readonly fingerprint: string;
    readonly fileId: string;
    readonly version: number;
  } | null;
  record(
    operationId: string,
    fingerprint: string,
    fileId: string,
    version: number,
  ): void;
}
