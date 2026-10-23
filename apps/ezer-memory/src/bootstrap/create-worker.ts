import {
  createCommitMemory,
  createConnectMemory,
  createInspectMemory,
  createDescribeMemoryService,
  createInspectMemoryState,
  createDescribeMemoryBinding,
  createListMemories,
  createSearchMemories,
  createMemoryOperations,
  createExportMemoryHistory,
  createRestoreMemoryHistory,
  createInspectMemoryRestore,
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

import { createHttpRouter } from "../delivery/index.ts";
import metadata from "../../package.json" with { type: "json" };
import { readWorkerConfiguration } from "../configuration/index.ts";
import { createAccessControl } from "../modules/access/application/index.ts";
import { createAccessPolicyReader } from "../modules/access/infrastructure/configuration/index.ts";
import { createCredentialVerifierFactory } from "../modules/access/infrastructure/jwt/index.ts";

import { createAccessSessionVerifierFactory } from "../modules/access/infrastructure/cloudflare-access/index.ts";
import { createOAuthAuthority } from "../modules/access/infrastructure/cloudflare-oauth/index.ts";
import { createAuthorizationHttpHandler } from "../modules/access/delivery/index.ts";

export function createWorker() {
  const describeService = createDescribeMemoryService(metadata.version);
  const createVerifier = createCredentialVerifierFactory();
  const createSessionVerifier = createAccessSessionVerifierFactory();
  return {
    fetch: async (request: Request, env: Env, context: ExecutionContext) => {
      const configuration = readWorkerConfiguration(env.EZER_AUTHORIZATION);
      const authority = configuration?.oauth
        ? createOAuthAuthority(configuration.oauth, env)
        : undefined;
      const authorization =
        authority && configuration?.access
          ? createAuthorizationHttpHandler(
              configuration.oauth!.issuer,
              createAccessControl(
                createAccessPolicyReader(configuration.bindings),
                createSessionVerifier(configuration.access),
              ),
              authority.oauth,
              authority.fetch,
            )
          : undefined;
      return createHttpRouter([
        authorization,
        createMemoryHttpHandler(
          createConnectMemory(
            createMemoryAccessGateway(
              createAccessControl(
                createAccessPolicyReader(configuration?.bindings),
                authority?.verifier ?? createVerifier(configuration?.jwt),
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
        ),
      ])(request, context);
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
      createSearchMemories(unitOfWork),
      createExportMemoryHistory(unitOfWork),
      createRestoreMemoryHistory(unitOfWork),
      createInspectMemoryRestore(unitOfWork),
    ),
  };
}
