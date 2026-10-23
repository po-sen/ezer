export interface RestoreStore {
  read(): {
    readonly restoreId: string;
    readonly snapshotSequence: number;
    readonly complete: boolean;
  } | null;
  start(restoreId: string, snapshotSequence: number): void;
  complete(): void;
}
