export interface MemoryConnection {
  readonly individualId: string;
  readonly capabilities: {
    readonly read: boolean;
    readonly restore: boolean;
    readonly write: boolean;
  };
}
