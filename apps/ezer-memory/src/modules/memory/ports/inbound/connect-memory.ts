export interface ConnectMemory {
  describe():
    | { readonly resource: string; readonly authorizationServer: string }
    | undefined;
  execute(credential: string | null): Promise<
    | { readonly ok: true; readonly individualId: string }
    | {
        readonly ok: false;
        readonly code:
          | "UNAUTHENTICATED"
          | "FORBIDDEN"
          | "INSUFFICIENT_SCOPE"
          | "UNAVAILABLE";
      }
  >;
}
