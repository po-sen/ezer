export interface MemoryExportQuery {
  readonly limit?: number;
  readonly cursor?: {
    readonly snapshotSequence: number;
    readonly afterSequence: number;
  };
}
