import type {
  MemoryReceipt,
  MemoryResult,
  MemoryWrite,
} from "../domain/memory";

export interface CommitMemory {
  execute(command: MemoryWrite): Promise<MemoryResult<MemoryReceipt>>;
}
