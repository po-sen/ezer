import metadata from "../../package.json" with { type: "json" };
import {
  prepareLocalDirectory,
  createLocalRuntime,
  requireLocalConnection,
} from "../runtime/index.ts";
import { createAccessControl } from "../modules/access/application/index.ts";
import { createLocalProcessVerifier } from "../modules/access/infrastructure/local-process/index.ts";
import { createAccessPolicyReader } from "../modules/access/infrastructure/configuration/index.ts";
import { createMemoryAccessGateway } from "../modules/memory/infrastructure/acl/access/index.ts";
import {
  createConnectMemory,
  createEmbeddedMemory,
  createDescribeMemoryService,
} from "../modules/memory/application/index.ts";
import { createRequestFingerprint } from "../modules/memory/infrastructure/index.ts";
import { openLocalMemory } from "../modules/memory/infrastructure/persistence/sqlite/node/index.ts";
import {
  createMigrationRunner,
  migrateMemory,
} from "../modules/memory/infrastructure/persistence/sqlite/cli/index.ts";
import { registerMemoryService } from "../modules/memory/delivery/index.ts";
import { openWorkspace } from "../modules/workspace/infrastructure/persistence/sqlite/index.ts";
import { createWorkspaceFingerprint } from "../modules/workspace/infrastructure/index.ts";
import { createWorkspaceAccessGateway } from "../modules/workspace/infrastructure/acl/access/index.ts";
import {
  createWorkspaceOperations,
  createConnectWorkspace,
} from "../modules/workspace/application/index.ts";
import { registerWorkspaceTools } from "../modules/workspace/delivery/index.ts";
import { serveLocalMcp } from "../delivery/local/index.ts";

export function createLocal(settings: {
  individualId: string;
  dataDirectory?: string;
  allowRestore: boolean;
  memoryMigrations: string;
  workspaceMigrations: string;
}) {
  return createLocalRuntime(async (own) => {
    const paths = prepareLocalDirectory(
      settings.individualId,
      settings.dataDirectory,
    );
    const access = createAccessControl(
      createAccessPolicyReader([
        { subject: "local-process", individualId: settings.individualId },
      ]),
      createLocalProcessVerifier(settings.individualId, settings.allowRestore),
    );
    const memoryConnection = requireLocalConnection(
      await createConnectMemory(createMemoryAccessGateway(access)).execute(
        null,
      ),
    );
    const workspaceConnection = requireLocalConnection(
      await createConnectWorkspace(
        createWorkspaceAccessGateway(access),
      ).execute(),
    ).value;
    const memoryStorage = own(
      openLocalMemory(paths.memory, memoryConnection.individualId),
    );
    await migrateMemory(
      memoryStorage.database,
      createMigrationRunner(memoryStorage.database, settings.memoryMigrations),
    );
    memoryStorage.initialize();
    const workspaceStorage = own(
      openWorkspace(paths.workspace, settings.workspaceMigrations),
    );
    await workspaceStorage.up();
    workspaceStorage.initialize(workspaceConnection.individualId);
    const memory = createEmbeddedMemory(
      memoryConnection,
      memoryStorage.unitOfWork,
      createRequestFingerprint(),
      () => new Date().toISOString(),
    );
    const workspace = createWorkspaceOperations(
      workspaceConnection,
      workspaceStorage.unitOfWork,
      createWorkspaceFingerprint(),
      () => new Date().toISOString(),
    );
    return serveLocalMcp(metadata.version, [
      (server) =>
        registerMemoryService(
          server,
          createDescribeMemoryService(metadata.version),
          memoryConnection.individualId,
          memory.binding,
          memory.operations,
        ),
      (server) =>
        registerWorkspaceTools(server, workspaceConnection, workspace),
    ]);
  });
}
