export interface AuthorizedIndividual {
  readonly callerId: string;
  readonly individualId: string;
  readonly capabilities: {
    readonly readMemory: boolean;
    readonly writeMemory: boolean;
    readonly restoreMemory: boolean;
    readonly readWorkspace?: boolean;
    readonly writeWorkspace?: boolean;
  };
}
