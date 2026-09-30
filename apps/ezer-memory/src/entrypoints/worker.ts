import { DurableObject } from "cloudflare:workers";
import { createMemory, createWorker } from "../bootstrap/create-worker.ts";

export class EzerMemory extends DurableObject<Env> {
  #memory: ReturnType<typeof createMemory>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.#memory = createMemory(ctx.storage, ctx.id.toString());
    ctx.blockConcurrencyWhile(async () => this.#memory.initialize());
  }

  commit(input: unknown) {
    return this.#memory.commit(input);
  }

  inspect(input: unknown) {
    return this.#memory.inspect(input);
  }
}

export default createWorker();
