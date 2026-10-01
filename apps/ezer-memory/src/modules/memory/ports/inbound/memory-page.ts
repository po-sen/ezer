export interface MemoryPage {
  readonly individualId: string;
  readonly changeSequence: number;
  readonly memories: readonly {
    readonly memoryId: string;
    readonly revision: number;
    readonly preview: string;
    readonly recordedAt: string;
    readonly changeSequence: number;
  }[];
  readonly nextCursor: {
    readonly snapshotSequence: number;
    readonly afterSequence: number;
  } | null;
}
