export interface MemoryAccessGateway {
  resolveIndividual(credential: string | null): Promise<
    | {
        readonly status: "authorized";
        readonly individualId: string;
        readonly capabilities: {
          readonly read: boolean;
          readonly write: boolean;
        };
      }
    | {
        readonly status: "denied";
        readonly reason:
          | "identity-required"
          | "individual-not-granted"
          | "connection-not-granted";
      }
    | { readonly status: "unavailable" }
  >;
}
