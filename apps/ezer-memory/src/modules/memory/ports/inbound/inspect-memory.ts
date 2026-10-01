import type { MemoryResult } from "./memory-result.ts";
import type { MemoryLookup } from "./memory-lookup.ts";
import type { MemoryInspection } from "./memory-inspection.ts";
export interface InspectMemory {
  execute(lookup: MemoryLookup): MemoryResult<MemoryInspection>;
}
