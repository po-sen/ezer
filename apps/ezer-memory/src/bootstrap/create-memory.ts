import { createCommitMemory } from "../modules/memory/application/commit-memory.ts";
import { createInspectMemory } from "../modules/memory/application/inspect-memory.ts";
import { createMemoryRpcHandler } from "../modules/memory/delivery/rpc.ts";
import { createRequestFingerprint } from "../modules/memory/infrastructure/request-fingerprint.ts";
import { initializeIndividual } from "../modules/memory/infrastructure/persistence/durable-object/initialize-individual.ts";
import { migrateMemory } from "../modules/memory/infrastructure/persistence/durable-object/migrate-memory.ts";
import { createDurableObjectUnitOfWork } from "../modules/memory/infrastructure/persistence/durable-object/unit-of-work.ts";

export function createMemory(
  storage: DurableObjectStorage,
  individualId: string,
) {
  const unitOfWork = createDurableObjectUnitOfWork(storage);
  return {
    initialize() {
      migrateMemory(storage);
      initializeIndividual(storage, individualId);
    },
    ...createMemoryRpcHandler(
      createCommitMemory(unitOfWork, createRequestFingerprint(), () =>
        new Date().toISOString(),
      ),
      createInspectMemory(unitOfWork),
    ),
  };
}
