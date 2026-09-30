import type { MemoryResult } from "./memory-result.ts";

export interface DescribeMemoryBinding {
  execute(individualId: string): Promise<
    MemoryResult<{
      readonly individualId: string;
      readonly changeSequence: number;
    }>
  >;
}
