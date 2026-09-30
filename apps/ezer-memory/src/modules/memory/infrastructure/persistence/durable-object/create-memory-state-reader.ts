import {
  PersistenceFault,
  type MemoryStateReader,
} from "../../../ports/outbound/index.ts";

export function createMemoryStateReader(
  namespace: Env["EZER_MEMORY"],
): MemoryStateReader {
  return {
    async read(individualId) {
      try {
        // This versioned name is the persistent routing contract, independent of sessions and principals.
        const result = await namespace
          .getByName(`ezer:v1:${individualId}`)
          .inspectState();
        if (!result.ok) throw new PersistenceFault();
        return { changeSequence: result.value.changeSequence };
      } catch {
        throw new PersistenceFault();
      }
    },
  };
}
