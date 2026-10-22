export interface MemoryPageQuery {
  readonly order?: "oldest" | "newest";
  readonly limit?: number;
  readonly cursor?: {
    readonly order?: "newest";
    readonly snapshotSequence: number;
    readonly afterSequence: number;
  };
}
