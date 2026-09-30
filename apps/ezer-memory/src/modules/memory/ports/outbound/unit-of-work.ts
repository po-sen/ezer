import type { MemoryStores } from "./memory-stores.ts";
export interface UnitOfWork {
  // Only scoped capabilities cross this boundary; never a native transaction.
  // Work must complete synchronously. Adapters reject async callbacks and expired scopes.
  within<T>(
    work: (stores: MemoryStores) => T extends PromiseLike<unknown> ? never : T,
  ): T;
}
