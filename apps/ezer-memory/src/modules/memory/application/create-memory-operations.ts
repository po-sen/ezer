import { MemoryFault, validateMemoryId } from "../domain/index.ts";
import type {
  MemoryConnection,
  MemoryOperations,
  MemoryResult,
} from "../ports/inbound/index.ts";
import {
  PersistenceFault,
  type MemoryPersistence,
} from "../ports/outbound/index.ts";

export function createMemoryOperations(
  connection: MemoryConnection,
  persistence: MemoryPersistence,
): MemoryOperations {
  const { individualId } = connection;
  const { read, write } = connection.capabilities;
  async function perform<T>(
    allowed: boolean,
    denial: "READ_NOT_GRANTED" | "WRITE_NOT_GRANTED",
    work: () => Promise<MemoryResult<T>>,
  ): Promise<MemoryResult<T>> {
    if (!allowed) return { ok: false, code: denial };
    try {
      validateMemoryId(individualId);
      return await work();
    } catch (error) {
      if (error instanceof MemoryFault) return { ok: false, code: error.code };
      if (error instanceof PersistenceFault)
        return { ok: false, code: "UNAVAILABLE" };
      throw error;
    }
  }
  return {
    commit(command) {
      return perform(write, "WRITE_NOT_GRANTED", async () => {
        const content = {
          operationId: command.operationId,
          memoryId: command.memoryId,
          body: command.body,
          source: {
            reference: command.source.reference,
            excerpt: command.source.excerpt,
          },
        };
        const result = await persistence.commit(
          individualId,
          command.kind === "remember"
            ? { ...content, kind: "remember" }
            : {
                ...content,
                kind: "revise",
                expectedRevision: command.expectedRevision,
                reason: command.reason,
              },
        );
        if (!result.ok) return result;
        return {
          ok: true,
          value: {
            individualId,
            memoryId: result.value.memoryId,
            revision: result.value.revision,
            recordedAt: result.value.recordedAt,
            changeSequence: result.value.changeSequence,
          },
        };
      });
    },
    inspect(query) {
      return perform(read, "READ_NOT_GRANTED", async () => {
        const result = await persistence.inspect(individualId, {
          memoryId: query.memoryId,
          ...(query.revision === undefined ? {} : { revision: query.revision }),
        });
        if (!result.ok) return result;
        const memory = result.value.memory;
        return {
          ok: true,
          value: {
            individualId,
            changeSequence: result.value.changeSequence,
            memory: {
              individualId,
              memoryId: memory.memoryId,
              revision: memory.revision,
              recordedAt: memory.recordedAt,
              changeSequence: memory.changeSequence,
              body: memory.body,
              source: {
                reference: memory.source.reference,
                excerpt: memory.source.excerpt,
              },
              reason: memory.reason,
            },
          },
        };
      });
    },
    list(query) {
      return perform(read, "READ_NOT_GRANTED", async () => {
        const result = await persistence.list(individualId, {
          ...(query.limit === undefined ? {} : { limit: query.limit }),
          ...(query.cursor === undefined
            ? {}
            : {
                cursor: {
                  snapshotSequence: query.cursor.snapshotSequence,
                  afterSequence: query.cursor.afterSequence,
                },
              }),
        });
        if (!result.ok) return result;
        return {
          ok: true,
          value: {
            individualId,
            changeSequence: result.value.changeSequence,
            memories: result.value.memories.map((memory) => ({
              memoryId: memory.memoryId,
              revision: memory.revision,
              recordedAt: memory.recordedAt,
              changeSequence: memory.changeSequence,
              preview: memory.preview,
            })),
            nextCursor: result.value.nextCursor && {
              snapshotSequence: result.value.nextCursor.snapshotSequence,
              afterSequence: result.value.nextCursor.afterSequence,
            },
          },
        };
      });
    },
  };
}
