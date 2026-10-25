import type {
  WorkspaceConnection,
  WorkspaceResult,
} from "../ports/inbound/index.ts";
import type { WorkspaceAccessGateway } from "../ports/outbound/index.ts";

export function createConnectWorkspace(gateway: WorkspaceAccessGateway) {
  return {
    async execute(): Promise<WorkspaceResult<WorkspaceConnection>> {
      try {
        const result = await gateway.authorize();
        if (
          !result ||
          !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(result.individualId)
        )
          return { ok: false, code: "UNAVAILABLE" };
        return {
          ok: true,
          value: {
            individualId: result.individualId,
            capabilities: { read: result.readFiles, write: result.writeFiles },
          },
        };
      } catch {
        return { ok: false, code: "UNAVAILABLE" };
      }
    },
  };
}
