import type { WorkspaceCommand } from "./workspace-command.ts";
import type { WorkspaceFile } from "./workspace-file.ts";
import type { WorkspaceResult } from "./workspace-result.ts";

interface Cursor {
  readonly snapshotSequence: number;
  readonly afterSequence: number;
  readonly deleted: boolean;
}
export interface WorkspaceOperations {
  mutate(command: WorkspaceCommand): Promise<WorkspaceResult<WorkspaceFile>>;
  read(query: {
    readonly fileId: string;
    readonly version?: number;
    readonly offset?: number;
    readonly length?: number;
  }): WorkspaceResult<{
    readonly file: WorkspaceFile;
    readonly content: Uint8Array;
    readonly nextOffset: number | null;
  }>;
  list(query: {
    readonly deleted?: boolean;
    readonly limit?: number;
    readonly cursor?: Cursor;
  }): WorkspaceResult<{
    readonly files: readonly WorkspaceFile[];
    readonly nextCursor: Cursor | null;
  }>;
  history(query: {
    readonly fileId: string;
    readonly beforeVersion?: number;
    readonly limit?: number;
  }): WorkspaceResult<{
    readonly files: readonly WorkspaceFile[];
    readonly nextBeforeVersion: number | null;
  }>;
}
