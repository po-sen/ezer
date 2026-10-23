import type { InspectMemoryRestore } from "../ports/inbound/index.ts";
import { PersistenceFault, type UnitOfWork } from "../ports/outbound/index.ts";

export function createInspectMemoryRestore(
  unitOfWork: UnitOfWork,
): InspectMemoryRestore {
  return {
    execute() {
      try {
        return unitOfWork.within((stores) => {
          const restore = stores.restore.read();
          return {
            ok: true,
            value: {
              restore: restore && {
                restoreId: restore.restoreId,
                snapshotSequence: restore.snapshotSequence,
                restoredSequence: Math.min(
                  stores.state.read().changeSequence,
                  restore.snapshotSequence,
                ),
                complete: restore.complete,
              },
            },
          };
        });
      } catch (error) {
        if (error instanceof PersistenceFault)
          return { ok: false, code: "UNAVAILABLE" };
        throw error;
      }
    },
  };
}
