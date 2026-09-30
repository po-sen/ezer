import type { InspectMemoryState } from "../ports/inbound/index.ts";
import { PersistenceFault, type UnitOfWork } from "../ports/outbound/index.ts";

export function createInspectMemoryState(
  unitOfWork: UnitOfWork,
): InspectMemoryState {
  return {
    execute() {
      try {
        return unitOfWork.within((stores) => ({
          ok: true,
          value: { changeSequence: stores.state.read().changeSequence },
        }));
      } catch (error) {
        if (error instanceof PersistenceFault)
          return { ok: false, code: "UNAVAILABLE" };
        throw error;
      }
    },
  };
}
