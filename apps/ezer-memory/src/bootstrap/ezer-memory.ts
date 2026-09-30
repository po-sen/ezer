import { DurableObject } from "cloudflare:workers";
import { createCommitMemory } from "../memory/application/commit-memory";
import { createInspectMemory } from "../memory/application/inspect-memory";
import { createMemoryRpcHandler } from "../memory/delivery/rpc";
import { createRequestFingerprint } from "../memory/infrastructure/request-fingerprint";
import { initializeIndividual } from "../memory/infrastructure/persistence/sqlite/initialize-individual";
import { migrateMemory } from "../memory/infrastructure/persistence/sqlite/migrate-memory";
import { createSqliteUnitOfWork } from "../memory/infrastructure/persistence/sqlite/unit-of-work";

// Cloudflare requires the exported class to own object lifecycle and RPC methods.
// This entry point only initializes adapters, composes use cases, and delegates.
export class EzerMemory extends DurableObject<Env> {
  #rpc: ReturnType<typeof createMemoryRpcHandler>;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      migrateMemory(ctx.storage);
      initializeIndividual(ctx.storage, ctx.id.toString());
    });
    const unitOfWork = createSqliteUnitOfWork(ctx.storage);
    this.#rpc = createMemoryRpcHandler(
      createCommitMemory(unitOfWork, createRequestFingerprint(), () =>
        new Date().toISOString(),
      ),
      createInspectMemory(unitOfWork),
    );
  }
  commit(input: unknown) {
    return this.#rpc.commit(input);
  }
  inspect(input: unknown) {
    return this.#rpc.inspect(input);
  }
}
