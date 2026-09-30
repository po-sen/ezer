export interface AccessPolicy {
  readonly issuer: string;
  readonly resource: string;
  readonly jwksUri: string;
  readonly bindings: readonly {
    readonly subject: string;
    readonly individualId: string;
  }[];
}
