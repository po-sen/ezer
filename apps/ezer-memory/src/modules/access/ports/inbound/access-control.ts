import type { AuthorizedIndividual } from "./authorized-individual.ts";

export interface AccessControl {
  describe():
    { readonly resource: string; readonly issuer: string } | undefined;
  authorize(token: string | null): Promise<
    | { readonly ok: true; readonly individual: AuthorizedIndividual }
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
