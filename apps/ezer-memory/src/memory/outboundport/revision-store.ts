import type { MemoryRevision } from "../domain/memory-revision";
// An append-only ledger, not a mutable aggregate collection.
export interface RevisionStore {
  find(memoryId: string, revision?: number): MemoryRevision | null;
  append(revision: MemoryRevision): void;
}
