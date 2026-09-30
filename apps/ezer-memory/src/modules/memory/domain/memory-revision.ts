import type { MemorySource } from "./memory-source.ts";
export interface MemoryRevision {
  readonly memoryId: string;
  readonly revision: number;
  readonly body: string;
  readonly source: MemorySource;
  readonly reason: string | null;
  readonly recordedAt: string;
  readonly changeSequence: number;
}
