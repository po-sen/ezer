interface RecordedOperation {
  readonly fingerprint: string;
  readonly memoryId: string;
  readonly revision: number;
  readonly recordedAt: string;
  readonly changeSequence: number;
}
export interface OperationStore {
  find(operationId: string): RecordedOperation | null;
  record(operationId: string, operation: RecordedOperation): void;
}
