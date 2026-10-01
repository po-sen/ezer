import type { MemoryResult } from "./memory-result.ts";

export interface InspectMemoryState {
  execute(): MemoryResult<{ readonly changeSequence: number }>;
}
