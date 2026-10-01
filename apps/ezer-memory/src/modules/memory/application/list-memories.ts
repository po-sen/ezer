import type { ListMemories } from "../ports/inbound/index.ts";
import { PersistenceFault, type UnitOfWork } from "../ports/outbound/index.ts";

export function createListMemories(unitOfWork: UnitOfWork): ListMemories {
  return {
    execute(query) {
      const limit = query.limit ?? 10;
      const cursor = query.cursor;
      if (
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 50 ||
        (cursor !== undefined &&
          (!Number.isSafeInteger(cursor.snapshotSequence) ||
            cursor.snapshotSequence < 0 ||
            !Number.isSafeInteger(cursor.afterSequence) ||
            cursor.afterSequence < 0 ||
            cursor.afterSequence > cursor.snapshotSequence))
      )
        return { ok: false, code: "INVALID_INPUT" };
      try {
        return unitOfWork.within((stores) => {
          const state = stores.state.read();
          const snapshotSequence =
            cursor?.snapshotSequence ?? state.changeSequence;
          if (snapshotSequence > state.changeSequence)
            return { ok: false, code: "INVALID_INPUT" } as const;
          const revisions = stores.revisions.list(
            snapshotSequence,
            cursor?.afterSequence ?? 0,
            limit + 1,
          );
          const page = revisions.slice(0, limit);
          return {
            ok: true,
            value: {
              individualId: state.individualId,
              changeSequence: snapshotSequence,
              memories: page.map((revision) => ({
                memoryId: revision.memoryId,
                revision: revision.revision,
                preview: revision.body.slice(0, 160),
                recordedAt: revision.recordedAt,
                changeSequence: revision.changeSequence,
              })),
              nextCursor:
                revisions.length > limit
                  ? {
                      snapshotSequence,
                      afterSequence: page[page.length - 1]!.changeSequence,
                    }
                  : null,
            },
          } as const;
        });
      } catch (error) {
        if (error instanceof PersistenceFault)
          return { ok: false, code: "UNAVAILABLE" };
        throw error;
      }
    },
  };
}
