import type { CredentialVerifier } from "../../ports/outbound/index.ts";

export function createLocalProcessVerifier(
  individualId: string,
  allowRestore: boolean,
): CredentialVerifier {
  return {
    async verify(credential) {
      // Only the private stdio composition uses this adapter. It never verifies HTTP credentials.
      if (credential !== null) return { status: "unrecognized" };
      return {
        status: "verified",
        callerId: "local-process",
        restrictedIndividualId: individualId,
        permissions: [
          "connect",
          "read-memory",
          "write-memory",
          "read-workspace",
          "write-workspace",
          ...(allowRestore ? ["restore-memory" as const] : []),
        ],
      };
    },
  };
}
