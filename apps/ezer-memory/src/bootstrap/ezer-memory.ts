import { DurableObject } from "cloudflare:workers";
import { createCommitMemory } from "../memory/application/commit-memory";
import { createInspectMemory } from "../memory/application/inspect-memory";
import { createMemoryRpcHandler } from "../memory/delivery/rpc";
import type { MemoryLookup, MemoryWrite } from "../memory/domain/memory";
import { migrateMemoryStore } from "../memory/infrastructure/migrate-memory-store";
import { createRequestFingerprint } from "../memory/infrastructure/request-fingerprint";
import { createSqliteMemoryStore } from "../memory/infrastructure/sqlite-memory-store";

// Only callers with a Worker binding can use this internal RPC surface.
// HTTP/MCP must authorize a fixed individual before selecting its object.
export class EzerMemory extends DurableObject<Env> {
  #rpc: ReturnType<typeof createMemoryRpcHandler>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      migrateMemoryStore(ctx.storage, ctx.id.toString());
    });
    const store = createSqliteMemoryStore(ctx.storage);
    this.#rpc = createMemoryRpcHandler(
      createCommitMemory(store, createRequestFingerprint(), () =>
        new Date().toISOString(),
      ),
      createInspectMemory(store),
    );
  }

  commit(command: MemoryWrite) {
    return this.#rpc.commit(command);
  }

  inspect(lookup: MemoryLookup) {
    return this.#rpc.inspect(lookup);
  }
}
