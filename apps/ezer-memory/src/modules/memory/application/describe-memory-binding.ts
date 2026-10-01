import { MemoryFault, validateMemoryId } from "../domain/index.ts";
import type { DescribeMemoryBinding } from "../ports/inbound/index.ts";
import {
  PersistenceFault,
  type MemoryStateReader,
} from "../ports/outbound/index.ts";

export function createDescribeMemoryBinding(
  reader: MemoryStateReader,
): DescribeMemoryBinding {
  return {
    async execute(individualId) {
      try {
        validateMemoryId(individualId);
        const state = await reader.read(individualId);
        return {
          ok: true,
          value: { individualId, changeSequence: state.changeSequence },
        };
      } catch (error) {
        if (error instanceof MemoryFault)
          return { ok: false, code: error.code };
        if (error instanceof PersistenceFault)
          return { ok: false, code: "UNAVAILABLE" };
        throw error;
      }
    },
  };
}
