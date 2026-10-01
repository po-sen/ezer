import type { AccessControl } from "../../../../access/ports/inbound/index.ts";
import type { MemoryAccessGateway } from "../../../ports/outbound/index.ts";

export function createMemoryAccessGateway(
  access: AccessControl,
): MemoryAccessGateway {
  return {
    async resolveIndividual(credential) {
      try {
        const result = await access.authorize(credential);
        if (result.ok)
          return {
            status: "authorized",
            individualId: result.individual.individualId,
            capabilities: {
              read: result.individual.capabilities.readMemory,
              write: result.individual.capabilities.writeMemory,
            },
          };
        switch (result.code) {
          case "UNRECOGNIZED_CREDENTIAL":
            return { status: "denied", reason: "identity-required" };
          case "UNASSIGNED_CALLER":
            return { status: "denied", reason: "individual-not-granted" };
          case "MISSING_PERMISSION":
            return { status: "denied", reason: "connection-not-granted" };
          default:
            return { status: "unavailable" };
        }
      } catch {
        // Foreign failures never escape into Memory's delivery or application.
        return { status: "unavailable" };
      }
    },
  };
}
