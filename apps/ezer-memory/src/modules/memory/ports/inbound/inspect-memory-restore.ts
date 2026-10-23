import type { MemoryRestoreStatus } from "./memory-restore-status.ts";
import type { MemoryResult } from "./memory-result.ts";

export interface InspectMemoryRestore {
  execute(): MemoryResult<MemoryRestoreStatus>;
}
