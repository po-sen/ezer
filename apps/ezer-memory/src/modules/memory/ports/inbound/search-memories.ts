import type { MemoryResult } from "./memory-result.ts";
import type { MemorySearchQuery } from "./memory-search-query.ts";
import type { MemorySearchPage } from "./memory-search-page.ts";

export interface SearchMemories {
  execute(query: MemorySearchQuery): MemoryResult<MemorySearchPage>;
}
