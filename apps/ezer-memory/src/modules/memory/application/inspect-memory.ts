import { MemoryFault, validateMemoryId } from "../domain/index.ts";

import type { InspectMemory } from "../ports/inbound/index.ts";
import { PersistenceFault } from "../ports/outbound/index.ts";
import type { UnitOfWork } from "../ports/outbound/index.ts";
export function createInspectMemory(unitOfWork: UnitOfWork): InspectMemory {
  return {
    execute(lookup) {
      try {
        validateMemoryId(lookup.memoryId);
        if (
          lookup.revision !== undefined &&
          (!Number.isSafeInteger(lookup.revision) || lookup.revision < 1)
        )
          return { ok: false, code: "INVALID_INPUT" };
        return unitOfWork.within((stores) => {
          const state = stores.state.read();
          const revision = stores.revisions.find(
            lookup.memoryId,
            lookup.revision,
          );
          if (!revision) return { ok: false, code: "NOT_FOUND" } as const;
          return {
            ok: true,
            value: {
              individualId: state.individualId,
              changeSequence: state.changeSequence,
              memory: {
                individualId: state.individualId,
                memoryId: revision.memoryId,
                revision: revision.revision,
                body: revision.body,
                source: {
                  reference: revision.source.reference,
                  excerpt: revision.source.excerpt,
                },
                reason: revision.reason,
                recordedAt: revision.recordedAt,
                changeSequence: revision.changeSequence,
              },
            },
          } as const;
        });
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
