import { validateMemoryId } from "../domain/index.ts";
import type { ConnectMemory } from "../ports/inbound/index.ts";
import type { MemoryAccessGateway } from "../ports/outbound/index.ts";

export function createConnectMemory(
  gateway: MemoryAccessGateway,
): ConnectMemory {
  return {
    async execute(credential) {
      try {
        const result = await gateway.resolveIndividual(credential);
        if (result.status === "authorized") {
          validateMemoryId(result.individualId);
          return {
            ok: true,
            individualId: result.individualId,
            capabilities: {
              read: result.capabilities.read,
              write: result.capabilities.write,
            },
          };
        }
        if (result.status === "denied") {
          switch (result.reason) {
            case "identity-required":
              return { ok: false, code: "IDENTITY_REQUIRED" };
            case "individual-not-granted":
              return { ok: false, code: "INDIVIDUAL_NOT_GRANTED" };
            case "connection-not-granted":
              return { ok: false, code: "CONNECTION_NOT_GRANTED" };
          }
        }
      } catch {
        // An unavailable or invalid connection must never reach memory storage.
      }
      return { ok: false, code: "UNAVAILABLE" };
    },
  };
}
