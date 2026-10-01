import type { MemoryWrite } from "./memory-write.ts";
import type { MemoryReceipt } from "./memory-receipt.ts";
import type { MemoryLookup } from "./memory-lookup.ts";
import type { MemoryInspection } from "./memory-inspection.ts";
import type { MemoryPageQuery } from "./memory-page-query.ts";
import type { MemoryPage } from "./memory-page.ts";
import type { MemoryResult } from "./memory-result.ts";
export interface MemoryOperations {
  commit(command: MemoryWrite): Promise<MemoryResult<MemoryReceipt>>;
  inspect(query: MemoryLookup): Promise<MemoryResult<MemoryInspection>>;
  list(query: MemoryPageQuery): Promise<MemoryResult<MemoryPage>>;
}
