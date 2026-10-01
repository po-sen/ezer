export interface AuthorizedIndividual {
  readonly individualId: string;
  readonly capabilities: {
    readonly readMemory: boolean;
    readonly writeMemory: boolean;
  };
}
