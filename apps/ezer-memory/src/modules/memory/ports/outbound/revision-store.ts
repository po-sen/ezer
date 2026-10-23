import type { MemoryRevision } from "../../domain/index.ts";
// An append-only ledger, not a mutable aggregate collection.
export interface RevisionStore {
  find(memoryId: string, revision?: number): MemoryRevision | null;
  history(
    snapshotSequence: number,
    afterSequence: number,
    limit: number,
  ): readonly MemoryRevision[];
  list(
    snapshotSequence: number,
    afterSequence: number,
    limit: number,
    order?: "oldest" | "newest",
  ): readonly MemoryRevision[];
  // Literal body substring; only ASCII letters are case-insensitive.
  search(
    query: string,
    snapshotSequence: number,
    afterSequence: number,
    limit: number,
  ): readonly MemoryRevision[];
  append(revision: MemoryRevision): void;
}
