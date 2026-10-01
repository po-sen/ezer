import type { AccessControl } from "../ports/inbound/index.ts";
import type {
  AccessPolicyReader,
  CredentialVerifier,
} from "../ports/outbound/index.ts";

export function createAccessControl(
  policyReader: AccessPolicyReader,
  verifier: CredentialVerifier,
): AccessControl {
  return {
    async authorize(credential) {
      try {
        const policy = policyReader.read();
        if (!policy) return { ok: false, code: "UNAVAILABLE" };
        const caller = await verifier.verify(credential);
        if (caller.status === "unavailable")
          return { ok: false, code: "UNAVAILABLE" };
        if (caller.status !== "verified")
          return { ok: false, code: "UNRECOGNIZED_CREDENTIAL" };
        const assignments = policy.assignments.filter(
          (entry) => entry.callerId === caller.callerId,
        );
        if (!assignments.length)
          return { ok: false, code: "UNASSIGNED_CALLER" };
        if (assignments.length !== 1) return { ok: false, code: "UNAVAILABLE" };
        if (!caller.permissions.includes("connect"))
          return { ok: false, code: "MISSING_PERMISSION" };
        return {
          ok: true,
          individual: { individualId: assignments[0]!.individualId },
        };
      } catch {
        return { ok: false, code: "UNAVAILABLE" };
      }
    },
  };
}
