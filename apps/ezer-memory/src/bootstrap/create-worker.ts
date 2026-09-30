import { createCommitMemory } from "../modules/memory/application/commit-memory.ts";
import { createInspectMemory } from "../modules/memory/application/inspect-memory.ts";
import { createMemoryRpcHandler } from "../modules/memory/delivery/rpc.ts";
import { createRequestFingerprint } from "../modules/memory/infrastructure/request-fingerprint.ts";
import { initializeIndividual } from "../modules/memory/infrastructure/persistence/durable-object/initialize-individual.ts";
import { migrateMemory } from "../modules/memory/infrastructure/persistence/durable-object/migrate-memory.ts";
import { createDurableObjectUnitOfWork } from "../modules/memory/infrastructure/persistence/durable-object/unit-of-work.ts";

import metadata from "../../package.json" with { type: "json" };
import { createDescribeMemoryService } from "../modules/memory/application/describe-service.ts";
import { createMemoryHttpHandler } from "../modules/memory/delivery/http.ts";
import { createMemoryMcpHandler } from "../modules/memory/delivery/mcp.ts";

export function createWorker(): ExportedHandler {
  const describeService = createDescribeMemoryService(metadata.version);
  return {
    fetch: createMemoryHttpHandler(createMemoryMcpHandler(describeService)),
  };
}

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
