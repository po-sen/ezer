export interface MemoryRestoreProgress {
  readonly restoreId: string;
  readonly snapshotSequence: number;
  readonly restoredSequence: number;
  readonly complete: boolean;
}
