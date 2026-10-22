import type { MemoryPage } from "./memory-page.ts";

export interface MemorySearchPage extends MemoryPage {
  readonly nextCursor: {
    readonly query: string;
    readonly snapshotSequence: number;
    readonly afterSequence: number;
  } | null;
}
