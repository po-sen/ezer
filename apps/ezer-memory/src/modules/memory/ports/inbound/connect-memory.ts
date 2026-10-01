export interface ConnectMemory {
  execute(credential: string | null): Promise<
    | { readonly ok: true; readonly individualId: string }
    | {
        readonly ok: false;
        readonly code:
          | "IDENTITY_REQUIRED"
          | "INDIVIDUAL_NOT_GRANTED"
          | "CONNECTION_NOT_GRANTED"
          | "UNAVAILABLE";
      }
  >;
}
