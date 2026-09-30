import type { CommitMemory } from "../inboundport/commit-memory";
import type { InspectMemory } from "../inboundport/inspect-memory";

export function createMemoryRpcHandler(
  commit: CommitMemory,
  inspect: InspectMemory,
) {
  return {
    async commit(command: Parameters<CommitMemory["execute"]>[0]) {
      try {
        return await commit.execute(command);
      } catch {
        // Retry with the original operation ID: an unavailable response is
        // not evidence that a write did or did not commit.
        return { ok: false, code: "UNAVAILABLE" } as const;
      }
    },
    inspect(lookup: Parameters<InspectMemory["execute"]>[0]) {
      try {
        return inspect.execute(lookup);
      } catch {
        return { ok: false, code: "UNAVAILABLE" } as const;
      }
    },
  };
}
