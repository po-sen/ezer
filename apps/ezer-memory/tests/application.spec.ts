import { describe, expect, it } from "vitest";
import { createCommitMemory } from "../src/modules/memory/application/commit-memory.ts";
import { createInspectMemory } from "../src/modules/memory/application/inspect-memory.ts";
import { createMemoryRpcHandler } from "../src/modules/memory/delivery/rpc.ts";
import type { MemoryWrite } from "../src/modules/memory/ports/inbound/memory-write.ts";
import { PersistenceFault } from "../src/modules/memory/ports/outbound/persistence-fault.ts";
import type { MemoryStores } from "../src/modules/memory/ports/outbound/memory-stores.ts";
import type { UnitOfWork } from "../src/modules/memory/ports/outbound/unit-of-work.ts";

const now = "2026-09-30T00:00:00.000Z";
function command(): MemoryWrite {
  return {
    kind: "remember",
    operationId: "op",
    memoryId: "memory",
    body: "Remember this.",
    source: { reference: "conversation:1", excerpt: "Please remember." },
  };
}
function harness() {
  const calls: string[] = [];
  const stores: MemoryStores = {
    state: {
      read: () => {
        calls.push("state");
        return { individualId: "alice", changeSequence: 0 };
      },
      advance: () => {
        calls.push("advance");
      },
    },
    revisions: {
      find: () => {
        calls.push("find");
        return null;
      },
      append: () => {
        calls.push("append");
      },
    },
    operations: {
      find: () => {
        calls.push("replay");
        return null;
      },
      record: () => {
        calls.push("record");
      },
    },
  };
  const unitOfWork: UnitOfWork = {
    within: (work) => {
      calls.push("begin");
      const value = work(stores);
      calls.push("commit");
      return value;
    },
  };
  const fingerprints = {
    digest: async (value: string) => {
      calls.push("fingerprint");
      return value;
    },
  };
  return { calls, stores, unitOfWork, fingerprints };
}

describe("memory application orchestration", () => {
  it("finishes external work before one Unit of Work containing all owner facts", async () => {
    const h = harness();
    const result = await createCommitMemory(
      h.unitOfWork,
      h.fingerprints,
      () => now,
    ).execute(command());
    expect(result).toEqual({
      ok: true,
      value: {
        individualId: "alice",
        memoryId: "memory",
        revision: 1,
        recordedAt: now,
        changeSequence: 1,
      },
    });
    expect(h.calls).toEqual([
      "fingerprint",
      "begin",
      "state",
      "replay",
      "find",
      "append",
      "advance",
      "record",
      "commit",
    ]);
  });

  it("snapshots a typed command before awaiting a dependency", async () => {
    const h = harness();
    const request = command();
    const mutable = request as { body: string; source: { excerpt: string } };
    const service = createCommitMemory(
      h.unitOfWork,
      {
        digest: async () => {
          mutable.body = "Changed while suspended";
          mutable.source.excerpt = "Changed source";
          return "fingerprint";
        },
      },
      () => now,
    );
    h.stores.revisions.append = (revision) => {
      expect(revision.body).toBe("Remember this.");
      expect(revision.source.excerpt).toBe("Please remember.");
    };
    expect((await service.execute(request)).ok).toBe(true);
  });

  it("resolves an old successful retry before reading the latest revision or writing", async () => {
    const h = harness();
    h.stores.operations.find = () => ({
      fingerprint: "same",
      memoryId: "memory",
      revision: 1,
      recordedAt: now,
      changeSequence: 1,
    });
    const result = await createCommitMemory(
      h.unitOfWork,
      { digest: async () => "same" },
      () => {
        throw new Error("Replay must not use the clock");
      },
    ).execute(command());
    expect(result).toMatchObject({ ok: true, value: { revision: 1 } });
    expect(h.calls).toEqual(["begin", "state", "commit"]);
  });

  it("maps persistence faults within use cases and leaves programming failures distinct", async () => {
    const h = harness();
    const failed: UnitOfWork = {
      within: () => {
        throw new PersistenceFault();
      },
    };
    const commit = createCommitMemory(failed, h.fingerprints, () => now);
    const inspect = createInspectMemory(failed);
    expect(await commit.execute(command())).toEqual({
      ok: false,
      code: "UNAVAILABLE",
    });
    expect(inspect.execute({ memoryId: "memory" })).toEqual({
      ok: false,
      code: "UNAVAILABLE",
    });
    const broken: UnitOfWork = {
      within: () => {
        throw new Error("synthetic private diagnostic");
      },
    };
    const rpc = createMemoryRpcHandler(
      createCommitMemory(broken, h.fingerprints, () => now),
      createInspectMemory(broken),
    );
    expect(await rpc.commit(command())).toEqual({
      ok: false,
      code: "INTERNAL_ERROR",
    });
    expect(rpc.inspect({ memoryId: "memory" })).toEqual({
      ok: false,
      code: "INTERNAL_ERROR",
    });
  });

  it("keeps read views detached from stored domain values", () => {
    const h = harness();
    const source = { reference: "conversation:1", excerpt: "Original" };
    h.stores.revisions.find = () => ({
      memoryId: "memory",
      revision: 1,
      body: "Original",
      source,
      reason: null,
      recordedAt: now,
      changeSequence: 1,
    });
    const result = createInspectMemory(h.unitOfWork).execute({
      memoryId: "memory",
    });
    source.excerpt = "Changed after inspection";
    expect(result).toMatchObject({
      ok: true,
      value: { memory: { source: { excerpt: "Original" } } },
    });
  });
});
