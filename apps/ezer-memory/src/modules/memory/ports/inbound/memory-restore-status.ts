import type { MemoryRestoreProgress } from "./memory-restore-progress.ts";

export interface MemoryRestoreStatus {
  readonly restore: MemoryRestoreProgress | null;
}
