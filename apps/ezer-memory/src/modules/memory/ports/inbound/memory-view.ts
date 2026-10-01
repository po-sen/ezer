import type { MemoryReceipt } from "./memory-receipt.ts";
export interface MemoryView extends MemoryReceipt {
  readonly body: string;
  readonly source: { readonly reference: string; readonly excerpt: string };
  readonly reason: string | null;
}
