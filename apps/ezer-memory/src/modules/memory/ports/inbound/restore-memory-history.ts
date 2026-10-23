import type { MemoryView } from "./memory-view.ts";
import type { MemoryResult } from "./memory-result.ts";
import type { MemoryRestoreProgress } from "./memory-restore-progress.ts";
export interface RestoreMemoryHistory {
  execute(command: {
    readonly restoreId: string;
    readonly snapshotSequence: number;
    readonly revisions: readonly Omit<MemoryView, "individualId">[];
    readonly complete: boolean;
  }): MemoryResult<MemoryRestoreProgress>;
}
