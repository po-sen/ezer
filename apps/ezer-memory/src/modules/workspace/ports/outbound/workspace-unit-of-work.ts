import type { WorkspaceStore } from "./workspace-store.ts";
export interface WorkspaceUnitOfWork {
  within<T>(
    work: (store: WorkspaceStore) => T extends PromiseLike<unknown> ? never : T,
  ): T;
}
