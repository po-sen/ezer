import type { AccessControl } from "../../../../access/ports/inbound/index.ts";
import type { MemoryAccessGateway } from "../../../ports/outbound/index.ts";

export function createMemoryAccessGateway(
  access: AccessControl,
): MemoryAccessGateway {
  return {
    describeResource() {
      try {
        const description = access.describe();
        return (
          description && {
            resource: description.resource,
            authorizationServer: description.issuer,
          }
        );
      } catch {
        return undefined;
      }
    },
    async resolveIndividual(credential) {
      try {
        const result = await access.authorize(credential);
        if (result.ok)
          return {
            status: "authorized",
            individualId: result.individual.individualId,
          };
        switch (result.code) {
          case "UNAUTHENTICATED":
            return { status: "denied", reason: "authentication" };
          case "FORBIDDEN":
            return { status: "denied", reason: "permission" };
          case "INSUFFICIENT_SCOPE":
            return { status: "denied", reason: "scope" };
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
