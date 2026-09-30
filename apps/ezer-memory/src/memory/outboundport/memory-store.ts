import type {
  MemoryReceipt,
  MemoryRevision,
  MemoryState,
} from "../domain/memory";

export interface MemoryOperation {
  readonly fingerprint: string;
  readonly receipt: MemoryReceipt;
}

export interface MemoryTransaction {
  state(): MemoryState;
  findRevision(memoryId: string, revision?: number): MemoryRevision | null;
  findOperation(operationId: string): MemoryOperation | null;
  appendRevision(revision: MemoryRevision): void;
  recordOperation(operationId: string, operation: MemoryOperation): void;
}

export interface MemoryStore {
  // The callback and all its reads/writes form one synchronous atomic snapshot.
  transaction<T>(work: (transaction: MemoryTransaction) => T): T;
}
