import type { MemoryWrite } from "./memory-write.ts";
import type { MemoryReceipt } from "./memory-receipt.ts";
import type { MemoryLookup } from "./memory-lookup.ts";
import type { MemoryInspection } from "./memory-inspection.ts";
import type { MemoryPageQuery } from "./memory-page-query.ts";
import type { MemoryPage } from "./memory-page.ts";
import type { MemoryResult } from "./memory-result.ts";
import type { MemorySearchQuery } from "./memory-search-query.ts";
import type { MemorySearchPage } from "./memory-search-page.ts";
import type { MemoryExportQuery } from "./memory-export-query.ts";
import type { MemoryExportPage } from "./memory-export-page.ts";
import type { MemoryRestoreProgress } from "./memory-restore-progress.ts";
export interface MemoryOperations {
  restoreHistory(command: {
    readonly restoreId: string;
    readonly page: MemoryExportPage;
  }): Promise<MemoryResult<MemoryRestoreProgress>>;
  commit(command: MemoryWrite): Promise<MemoryResult<MemoryReceipt>>;
  inspect(query: MemoryLookup): Promise<MemoryResult<MemoryInspection>>;
  list(query: MemoryPageQuery): Promise<MemoryResult<MemoryPage>>;
  search(query: MemorySearchQuery): Promise<MemoryResult<MemorySearchPage>>;
  exportHistory(
    query: MemoryExportQuery,
  ): Promise<MemoryResult<MemoryExportPage>>;
}
