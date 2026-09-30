import type {
  MemoryLookup,
  MemoryResult,
  MemoryRevision,
  MemoryState,
} from "../domain/memory";

export interface MemoryInspection extends MemoryState {
  readonly memory: MemoryRevision;
}

export interface InspectMemory {
  execute(lookup: MemoryLookup): MemoryResult<MemoryInspection>;
}
