import type { MemoryResult } from "./memory-result.ts";
import type { MemoryReceipt } from "./memory-receipt.ts";
interface WriteContent {
  readonly operationId: string;
  readonly memoryId: string;
  readonly body: string;
  readonly source: { readonly reference: string; readonly excerpt: string };
}
export type MemoryWrite =
  | (WriteContent & { readonly kind: "remember" })
  | (WriteContent & {
      readonly kind: "revise";
      readonly expectedRevision: number;
      readonly reason: string;
    });
export interface CommitMemory {
  execute(command: MemoryWrite): Promise<MemoryResult<MemoryReceipt>>;
}
