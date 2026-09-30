export interface MemoryReceipt {
  readonly individualId: string;
  readonly memoryId: string;
  readonly revision: number;
  readonly changeSequence: number;
  readonly recordedAt: string;
}
