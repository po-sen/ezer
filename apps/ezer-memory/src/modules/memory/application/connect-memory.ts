import { validateMemoryId } from "../domain/index.ts";
import type { ConnectMemory } from "../ports/inbound/index.ts";
import type { MemoryAccessGateway } from "../ports/outbound/index.ts";

export function createConnectMemory(
  gateway: MemoryAccessGateway,
): ConnectMemory {
  return {
    describe() {
      try {
        const description = gateway.describeResource();
        return (
          description && {
            resource: description.resource,
            authorizationServer: description.authorizationServer,
          }
        );
      } catch {
        return undefined;
      }
    },
    async execute(credential) {
      try {
        const result = await gateway.resolveIndividual(credential);
        if (result.status === "authorized") {
          validateMemoryId(result.individualId);
          return { ok: true, individualId: result.individualId };
        }
        if (result.status === "denied") {
          switch (result.reason) {
            case "authentication":
              return { ok: false, code: "UNAUTHENTICATED" };
            case "permission":
              return { ok: false, code: "FORBIDDEN" };
            case "scope":
              return { ok: false, code: "INSUFFICIENT_SCOPE" };
          }
        }
      } catch {
        // An unavailable or invalid connection must never reach memory storage.
      }
      return { ok: false, code: "UNAVAILABLE" };
    },
  };
}
