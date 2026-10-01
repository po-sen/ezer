import type { AuthorizedIndividual } from "./authorized-individual.ts";

export interface AccessControl {
  authorize(credential: string | null): Promise<
    | { readonly ok: true; readonly individual: AuthorizedIndividual }
    | {
        readonly ok: false;
        readonly code:
          | "UNRECOGNIZED_CREDENTIAL"
          | "UNASSIGNED_CALLER"
          | "MISSING_PERMISSION"
          | "UNAVAILABLE";
      }
  >;
}
