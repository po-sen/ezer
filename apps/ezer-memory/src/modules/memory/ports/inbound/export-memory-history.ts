import type { MemoryExportQuery } from "./memory-export-query.ts";
import type { MemoryExportPage } from "./memory-export-page.ts";
import type { MemoryResult } from "./memory-result.ts";

export interface ExportMemoryHistory {
  execute(query: MemoryExportQuery): MemoryResult<MemoryExportPage>;
}
