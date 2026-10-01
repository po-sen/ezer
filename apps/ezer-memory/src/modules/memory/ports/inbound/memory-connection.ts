export interface MemoryConnection {
  readonly individualId: string;
  readonly capabilities: { readonly read: boolean; readonly write: boolean };
}
