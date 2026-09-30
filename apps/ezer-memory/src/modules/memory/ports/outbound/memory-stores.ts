import type { IndividualStateStore } from "./individual-state-store.ts";
import type { OperationStore } from "./operation-store.ts";
import type { RevisionStore } from "./revision-store.ts";
export interface MemoryStores {
  readonly state: IndividualStateStore;
  readonly revisions: RevisionStore;
  readonly operations: OperationStore;
}
