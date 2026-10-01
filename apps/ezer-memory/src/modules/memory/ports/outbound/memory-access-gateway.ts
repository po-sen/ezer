export interface MemoryAccessGateway {
  describeResource():
    | { readonly resource: string; readonly authorizationServer: string }
    | undefined;
  resolveIndividual(credential: string | null): Promise<
    | { readonly status: "authorized"; readonly individualId: string }
    | {
        readonly status: "denied";
        readonly reason: "authentication" | "permission" | "scope";
      }
    | { readonly status: "unavailable" }
  >;
}
