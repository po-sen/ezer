import type { AccessControl } from "../ports/inbound/index.ts";
import type {
  AccessPolicyReader,
  AccessTokenVerifier,
} from "../ports/outbound/index.ts";

export function createAccessControl(
  policyReader: AccessPolicyReader,
  verifier: AccessTokenVerifier,
): AccessControl {
  return {
    describe() {
      const policy = policyReader.read();
      return policy && { resource: policy.resource, issuer: policy.issuer };
    },
    async authorize(token) {
      const policy = policyReader.read();
      if (!policy) return { ok: false, code: "UNAVAILABLE" };
      if (!token || token.length > 8192)
        return { ok: false, code: "UNAUTHENTICATED" };
      try {
        const principal = await verifier.verify(token, policy);
        if (!principal) return { ok: false, code: "UNAUTHENTICATED" };
        const binding = policy.bindings.find(
          (entry) => entry.subject === principal.subject,
        );
        if (!binding) return { ok: false, code: "FORBIDDEN" };
        if (!principal.scopes.includes("ezer:connect"))
          return { ok: false, code: "INSUFFICIENT_SCOPE" };
        return { ok: true, individual: { individualId: binding.individualId } };
      } catch {
        return { ok: false, code: "UNAVAILABLE" };
      }
    },
  };
}
