export interface CredentialVerifier {
  verify(credential: string | null): Promise<
    | {
        readonly status: "verified";
        readonly callerId: string;
        readonly restrictedIndividualId?: string;
        readonly permissions: readonly (
          | "connect"
          | "read-memory"
          | "write-memory"
          | "restore-memory"
          | "read-workspace"
          | "write-workspace"
        )[];
      }
    | { readonly status: "unrecognized" }
    | { readonly status: "unavailable" }
  >;
}
