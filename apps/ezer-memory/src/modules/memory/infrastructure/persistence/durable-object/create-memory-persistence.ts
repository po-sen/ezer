import {
  PersistenceFault,
  type MemoryPersistence,
} from "../../../ports/outbound/index.ts";

export function createMemoryPersistence(
  namespace: Env["EZER_MEMORY"],
): MemoryPersistence {
  return {
    async restoreHistory(individualId, command) {
      try {
        const result = await namespace
          .getByName(`ezer:v1:${individualId}`)
          .restoreHistory(command);
        if (!result.ok) return result;
        return {
          ok: true,
          value: {
            restoreId: result.value.restoreId,
            snapshotSequence: result.value.snapshotSequence,
            restoredSequence: result.value.restoredSequence,
            complete: result.value.complete,
          },
        };
      } catch {
        throw new PersistenceFault();
      }
    },
    async exportHistory(individualId, query) {
      try {
        const result = await namespace
          .getByName(`ezer:v1:${individualId}`)
          .exportHistory(query);
        if (!result.ok) return result;
        return {
          ok: true,
          value: {
            snapshotSequence: result.value.snapshotSequence,
            revisions: result.value.revisions.map((revision) => ({
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
            })),
            nextCursor: result.value.nextCursor && {
              snapshotSequence: result.value.nextCursor.snapshotSequence,
              afterSequence: result.value.nextCursor.afterSequence,
            },
          },
        };
      } catch {
        throw new PersistenceFault();
      }
    },
    async commit(individualId, command) {
      try {
        const result = await namespace
          .getByName(`ezer:v1:${individualId}`)
          .commit(command);
        if (!result.ok) return result;
        const receipt = result.value;
        return {
          ok: true,
          value: {
            memoryId: receipt.memoryId,
            revision: receipt.revision,
            recordedAt: receipt.recordedAt,
            changeSequence: receipt.changeSequence,
          },
        };
      } catch {
        throw new PersistenceFault();
      }
    },
    async inspect(individualId, query) {
      try {
        const result = await namespace
          .getByName(`ezer:v1:${individualId}`)
          .inspect(query);
        if (!result.ok) return result;
        const memory = result.value.memory;
        return {
          ok: true,
          value: {
            changeSequence: result.value.changeSequence,
            memory: {
              memoryId: memory.memoryId,
              revision: memory.revision,
              body: memory.body,
              source: {
                reference: memory.source.reference,
                excerpt: memory.source.excerpt,
              },
              reason: memory.reason,
              recordedAt: memory.recordedAt,
              changeSequence: memory.changeSequence,
            },
          },
        };
      } catch {
        throw new PersistenceFault();
      }
    },
    async list(individualId, query) {
      try {
        const result = await namespace
          .getByName(`ezer:v1:${individualId}`)
          .list(query);
        if (!result.ok) return result;
        return {
          ok: true,
          value: {
            changeSequence: result.value.changeSequence,
            memories: result.value.memories.map((memory) => ({
              memoryId: memory.memoryId,
              revision: memory.revision,
              recordedAt: memory.recordedAt,
              changeSequence: memory.changeSequence,
              preview: memory.preview,
            })),
            nextCursor: result.value.nextCursor && {
              ...(result.value.nextCursor.order === undefined
                ? {}
                : { order: result.value.nextCursor.order }),
              snapshotSequence: result.value.nextCursor.snapshotSequence,
              afterSequence: result.value.nextCursor.afterSequence,
            },
          },
        };
      } catch {
        throw new PersistenceFault();
      }
    },
    async search(individualId, query) {
      try {
        const result = await namespace
          .getByName(`ezer:v1:${individualId}`)
          .search(query);
        if (!result.ok) return result;
        return {
          ok: true,
          value: {
            changeSequence: result.value.changeSequence,
            memories: result.value.memories.map((memory) => ({
              memoryId: memory.memoryId,
              revision: memory.revision,
              recordedAt: memory.recordedAt,
              changeSequence: memory.changeSequence,
              preview: memory.preview,
            })),
            nextCursor: result.value.nextCursor && {
              query: result.value.nextCursor.query,
              snapshotSequence: result.value.nextCursor.snapshotSequence,
              afterSequence: result.value.nextCursor.afterSequence,
            },
          },
        };
      } catch {
        throw new PersistenceFault();
      }
    },
  };
}
