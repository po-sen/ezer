import {
  createCommitMemory,
  createConnectMemory,
  createInspectMemory,
  createDescribeMemoryService,
  createInspectMemoryState,
  createDescribeMemoryBinding,
  createListMemories,
  createMemoryOperations,
} from "../modules/memory/application/index.ts";

import {
  createMemoryRpcHandler,
  createMemoryHttpHandler,
  createMemoryMcpHandler,
} from "../modules/memory/delivery/index.ts";
import { createRequestFingerprint } from "../modules/memory/infrastructure/index.ts";
import { createMemoryAccessGateway } from "../modules/memory/infrastructure/acl/access/index.ts";
import {
  initializeIndividual,
  migrateMemory,
  createDurableObjectUnitOfWork,
  createMemoryStateReader,
  createMemoryPersistence,
} from "../modules/memory/infrastructure/persistence/durable-object/index.ts";

import metadata from "../../package.json" with { type: "json" };
import { readWorkerConfiguration } from "../configuration/index.ts";
import { createAccessControl } from "../modules/access/application/index.ts";
import { createAccessPolicyReader } from "../modules/access/infrastructure/configuration/index.ts";
import { createCredentialVerifierFactory } from "../modules/access/infrastructure/jwt/index.ts";

export function createWorker() {
  const describeService = createDescribeMemoryService(metadata.version);
  const createVerifier = createCredentialVerifierFactory();
  return {
    fetch: (request: Request, env: Env) => {
      const configuration = readWorkerConfiguration(env.EZER_AUTHORIZATION);
      return createMemoryHttpHandler(
        createConnectMemory(
          createMemoryAccessGateway(
            createAccessControl(
              createAccessPolicyReader(configuration?.bindings),
              createVerifier(configuration?.jwt),
            ),
          ),
        ),
        (connection) =>
          createMemoryMcpHandler(
            describeService,
            connection.individualId,
            createDescribeMemoryBinding(
              createMemoryStateReader(env.EZER_MEMORY),
            ),
            createMemoryOperations(
              connection,
              createMemoryPersistence(env.EZER_MEMORY),
            ),
          ),
        configuration?.http,
      )(request);
    },
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
      createListMemories(unitOfWork),
    ),
  };
}
