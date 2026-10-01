export interface AccessPolicy {
  readonly assignments: readonly {
    readonly callerId: string;
    readonly individualId: string;
  }[];
}
