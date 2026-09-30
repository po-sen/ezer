import type { IndividualStateStore } from "./individual-state-store.ts";
import type { OperationStore } from "./operation-store.ts";
import type { RevisionStore } from "./revision-store.ts";
export interface MemoryStores {
  readonly state: IndividualStateStore;
  readonly revisions: RevisionStore;
  readonly operations: OperationStore;
}
export interface UnitOfWork {
  // Only scoped capabilities cross this boundary; never a native transaction.
  // Work must complete synchronously. Adapters reject async callbacks and expired scopes.
  within<T>(
    work: (stores: MemoryStores) => T extends PromiseLike<unknown> ? never : T,
  ): T;
}
