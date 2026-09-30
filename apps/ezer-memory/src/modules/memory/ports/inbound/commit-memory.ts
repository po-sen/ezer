import type { MemoryResult } from "./memory-result.ts";
import type { MemoryReceipt } from "./memory-receipt.ts";
import type { MemoryWrite } from "./memory-write.ts";
export interface CommitMemory {
  execute(command: MemoryWrite): Promise<MemoryResult<MemoryReceipt>>;
}
