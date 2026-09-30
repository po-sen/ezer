import { parseMemoryLookup } from "../domain/parse-memory-lookup";
import type { InspectMemory } from "../inboundport/inspect-memory";
import type { MemoryStore } from "../outboundport/memory-store";

export function createInspectMemory(store: MemoryStore): InspectMemory {
  return {
    execute(input) {
      const lookup = parseMemoryLookup(input);
      if (!lookup) return { ok: false, code: "INVALID_INPUT" };
      return store.transaction((transaction) => {
        const memory = transaction.findRevision(
          lookup.memoryId,
          lookup.revision,
        );
        if (memory === null) return { ok: false, code: "NOT_FOUND" };
        return { ok: true, value: { ...transaction.state(), memory } };
      });
    },
  };
}
