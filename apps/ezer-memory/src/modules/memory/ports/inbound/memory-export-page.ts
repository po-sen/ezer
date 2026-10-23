import type { MemoryView } from "./memory-view.ts";

export interface MemoryExportPage {
  readonly format: "ezer-memory";
  readonly formatVersion: 1;
  readonly individualId: string;
  readonly snapshotSequence: number;
  readonly revisions: readonly MemoryView[];
  readonly nextCursor: {
    readonly snapshotSequence: number;
    readonly afterSequence: number;
  } | null;
}
