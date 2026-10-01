export interface CredentialVerifier {
  verify(credential: string | null): Promise<
    | {
        readonly status: "verified";
        readonly callerId: string;
        readonly permissions: readonly (
          "connect" | "read-memory" | "write-memory"
        )[];
      }
    | { readonly status: "unrecognized" }
    | { readonly status: "unavailable" }
  >;
}
