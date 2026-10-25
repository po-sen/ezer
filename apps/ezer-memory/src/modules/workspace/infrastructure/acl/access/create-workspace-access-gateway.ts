import type { AccessControl } from "../../../../access/ports/inbound/index.ts";
import type { WorkspaceAccessGateway } from "../../../ports/outbound/index.ts";

export function createWorkspaceAccessGateway(
  access: AccessControl,
): WorkspaceAccessGateway {
  return {
    async authorize() {
      const result = await access.authorize(null);
      if (!result.ok) return null;
      return {
        individualId: result.individual.individualId,
        readFiles: result.individual.capabilities.readWorkspace === true,
        writeFiles: result.individual.capabilities.writeWorkspace === true,
      };
    },
  };
}
