import type { MemoryResult } from "./memory-result.ts";
import type { MemoryReceipt } from "./memory-receipt.ts";
interface MemoryLookup {
  readonly memoryId: string;
  readonly revision?: number;
}
interface MemoryView extends MemoryReceipt {
  readonly body: string;
  readonly source: { readonly reference: string; readonly excerpt: string };
  readonly reason: string | null;
}
interface MemoryInspection {
  readonly individualId: string;
  readonly changeSequence: number;
  readonly memory: MemoryView;
}
export interface InspectMemory {
  execute(lookup: MemoryLookup): MemoryResult<MemoryInspection>;
}
