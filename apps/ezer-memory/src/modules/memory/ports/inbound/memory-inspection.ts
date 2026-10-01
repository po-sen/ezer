import type { MemoryView } from "./memory-view.ts";
export interface MemoryInspection {
  readonly individualId: string;
  readonly changeSequence: number;
  readonly memory: MemoryView;
}
