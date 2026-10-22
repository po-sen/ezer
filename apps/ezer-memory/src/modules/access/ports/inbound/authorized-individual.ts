export interface AuthorizedIndividual {
  readonly callerId: string;
  readonly individualId: string;
  readonly capabilities: {
    readonly readMemory: boolean;
    readonly writeMemory: boolean;
  };
}
