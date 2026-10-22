export interface MemorySearchQuery {
  readonly query: string;
  readonly limit?: number;
  readonly cursor?: {
    readonly query: string;
    readonly snapshotSequence: number;
    readonly afterSequence: number;
  };
}
