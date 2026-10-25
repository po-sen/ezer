import type { MemoryConnection, MemoryResult } from "../ports/inbound/index.ts";
import type {
  UnitOfWork,
  RequestFingerprint,
  MemoryPersistence,
} from "../ports/outbound/index.ts";
import { createMemoryOperations } from "./create-memory-operations.ts";
import { createCommitMemory } from "./commit-memory.ts";
import { createInspectMemory } from "./inspect-memory.ts";
import { createInspectMemoryState } from "./inspect-memory-state.ts";
import { createListMemories } from "./list-memories.ts";
import { createSearchMemories } from "./search-memories.ts";
import { createExportMemoryHistory } from "./export-memory-history.ts";
import { createRestoreMemoryHistory } from "./restore-memory-history.ts";
import { createInspectMemoryRestore } from "./inspect-memory-restore.ts";

export function createEmbeddedMemory(
  connection: MemoryConnection,
  unitOfWork: UnitOfWork,
  fingerprint: RequestFingerprint,
  now: () => string,
) {
  const commit = createCommitMemory(unitOfWork, fingerprint, now);
  const inspect = createInspectMemory(unitOfWork);
  const state = createInspectMemoryState(unitOfWork);
  const list = createListMemories(unitOfWork);
  const search = createSearchMemories(unitOfWork);
  const exporting = createExportMemoryHistory(unitOfWork);
  const restoring = createRestoreMemoryHistory(unitOfWork);
  const restoreStatus = createInspectMemoryRestore(unitOfWork);
  async function bound<T>(
    individualId: string,
    work: () => MemoryResult<T> | Promise<MemoryResult<T>>,
  ): Promise<MemoryResult<T>> {
    if (individualId !== connection.individualId)
      return { ok: false, code: "IDENTITY_MISMATCH" };
    return work();
  }
  // Compose the same use cases in-process; provider transactions remain behind the Unit of Work.
  const persistence: MemoryPersistence = {
    commit: (id, command) => bound(id, () => commit.execute(command)),
    inspect: (id, query) => bound(id, () => inspect.execute(query)),
    list: (id, query) => bound(id, () => list.execute(query)),
    search: (id, query) => bound(id, () => search.execute(query)),
    exportHistory: (id, query) => bound(id, () => exporting.execute(query)),
    restoreHistory: (id, command) =>
      bound(id, () => restoring.execute(command)),
    inspectRestore: (id) => bound(id, () => restoreStatus.execute()),
  };
  return {
    operations: createMemoryOperations(connection, persistence),
    binding: {
      async execute(individualId: string) {
        return bound(individualId, () => {
          const result = state.execute();
          return result.ok
            ? {
                ok: true,
                value: {
                  individualId,
                  changeSequence: result.value.changeSequence,
                },
              }
            : result;
        });
      },
    },
  };
}
