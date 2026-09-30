import {
  createCommitMemory,
  createInspectMemory,
  createDescribeMemoryService,
} from "../modules/memory/application/index.ts";

import {
  createMemoryRpcHandler,
  createMemoryHttpHandler,
  createMemoryMcpHandler,
} from "../modules/memory/delivery/index.ts";
import { createRequestFingerprint } from "../modules/memory/infrastructure/index.ts";
import {
  initializeIndividual,
  migrateMemory,
  createDurableObjectUnitOfWork,
} from "../modules/memory/infrastructure/persistence/durable-object/index.ts";

import metadata from "../../package.json" with { type: "json" };

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
