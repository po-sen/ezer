import type { MemorySource } from "./memory-source.ts";

interface RevisionContent {
  readonly memoryId: string;
  readonly body: string;
  readonly source: MemorySource;
}

export type RevisionIntent =
  | { readonly kind: "remember"; readonly content: RevisionContent }
  | {
      readonly kind: "revise";
      readonly content: RevisionContent;
      readonly expectedRevision: number;
      readonly reason: string;
    };
