import {
  createCommitMemory,
  createInspectMemory,
  createDescribeMemoryService,
  createInspectMemoryState,
  createDescribeMemoryBinding,
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
  createMemoryStateReader,
} from "../modules/memory/infrastructure/persistence/durable-object/index.ts";

import metadata from "../../package.json" with { type: "json" };
import { createAccessControl } from "../modules/access/application/index.ts";
import { createAccessPolicyReader } from "../modules/access/infrastructure/configuration/index.ts";
import { createAccessTokenVerifier } from "../modules/access/infrastructure/jwt/index.ts";

export function createWorker() {
  const describeService = createDescribeMemoryService(metadata.version);
  const verifier = createAccessTokenVerifier();
  return {
    fetch: (request: Request, env: Env) =>
      createMemoryHttpHandler(
        createAccessControl(
          createAccessPolicyReader(env.EZER_AUTHORIZATION),
          verifier,
        ),
        (individual) =>
          createMemoryMcpHandler(
            describeService,
            individual,
            createDescribeMemoryBinding(
              createMemoryStateReader(env.EZER_MEMORY),
            ),
          ),
      )(request),
  } satisfies ExportedHandler<Env>;
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
      createInspectMemoryState(unitOfWork),
    ),
  };
}
