import type { MemoryResult } from "./memory-result.ts";
import type { MemoryPageQuery } from "./memory-page-query.ts";
import type { MemoryPage } from "./memory-page.ts";
export interface ListMemories {
  execute(query: MemoryPageQuery): MemoryResult<MemoryPage>;
}
