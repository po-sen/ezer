import { describe, expect, it, vi } from "vitest";
import {
  createListMemories,
  createSearchMemories,
  createMemoryOperations,
} from "../src/modules/memory/application/index.ts";
import {
  PersistenceFault,
  type MemoryPersistence,
} from "../src/modules/memory/ports/outbound/index.ts";

const command = {
  kind: "remember" as const,
  operationId: "op",
  memoryId: "memory",
  body: "Synthetic",
  source: { reference: "test:source", excerpt: "Synthetic evidence" },
};
function persistence() {
  return {
    commit: vi.fn<MemoryPersistence["commit"]>(async () => ({
      ok: false,
      code: "NOT_FOUND",
    })),
    inspect: vi.fn<MemoryPersistence["inspect"]>(async () => ({
      ok: false,
      code: "NOT_FOUND",
    })),
    list: vi.fn<MemoryPersistence["list"]>(async () => ({
      ok: false,
      code: "NOT_FOUND",
    })),
    search: vi.fn<MemoryPersistence["search"]>(async () => ({
      ok: false,
      code: "NOT_FOUND",
    })),
  };
}

describe("Memory-owned operation grants", () => {
  it("denies access before touching any persistence capability", async () => {
    const gateway = persistence();
    const operations = createMemoryOperations(
      { individualId: "alice", capabilities: { read: false, write: false } },
      gateway,
    );
    expect(await operations.commit(command)).toEqual({
      ok: false,
      code: "WRITE_NOT_GRANTED",
    });
    expect(await operations.inspect({ memoryId: "memory" })).toEqual({
      ok: false,
      code: "READ_NOT_GRANTED",
    });
    expect(await operations.list({})).toEqual({
      ok: false,
      code: "READ_NOT_GRANTED",
    });
    expect(await operations.search({ query: "Synthetic" })).toEqual({
      ok: false,
      code: "READ_NOT_GRANTED",
    });
    for (const method of Object.values(gateway))
      expect(method).not.toHaveBeenCalled();
  });

  it("snapshots its granted identity and permissions and rejects an invalid identity", async () => {
    const gateway = persistence();
    const connection = {
      individualId: "alice",
      capabilities: { read: true, write: false },
    };
    const operations = createMemoryOperations(connection, gateway);
    connection.individualId = "bob";
    connection.capabilities.read = false;
    connection.capabilities.write = true;
    await operations.inspect({ memoryId: "memory" });
    expect(gateway.inspect).toHaveBeenCalledExactlyOnceWith("alice", {
      memoryId: "memory",
    });
    expect(await operations.commit(command)).toEqual({
      ok: false,
      code: "WRITE_NOT_GRANTED",
    });
    expect(
      await createMemoryOperations(
        { individualId: "../bob", capabilities: { read: true, write: true } },
        gateway,
      ).list({}),
    ).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(gateway.list).not.toHaveBeenCalled();
  });

  it("replaces storage identity with the logical identity and detaches stored values", async () => {
    const gateway = persistence();
    const stored = {
      individualId: "native-owner",
      memoryId: "memory",
      revision: 1,
      recordedAt: "2026-10-01T00:00:00Z",
      changeSequence: 1,
      body: "Synthetic",
      source: { reference: "test", excerpt: "Evidence" },
      reason: null,
    };
    gateway.inspect.mockResolvedValue({
      ok: true,
      value: { changeSequence: 1, memory: stored },
    });
    const operations = createMemoryOperations(
      { individualId: "alice", capabilities: { read: true, write: true } },
      gateway,
    );
    const result = await operations.inspect({ memoryId: "memory" });
    stored.source.excerpt = "Changed";
    expect(result).toMatchObject({
      ok: true,
      value: {
        individualId: "alice",
        memory: { individualId: "alice", source: { excerpt: "Evidence" } },
      },
    });
    expect(JSON.stringify(result)).not.toContain("native-owner");
    gateway.commit.mockImplementation(async (_individualId, input) => {
      expect(input).not.toBe(command);
      expect(input.source).not.toBe(command.source);
      return { ok: false, code: "OPERATION_CONFLICT" };
    });
    expect(await operations.commit(command)).toEqual({
      ok: false,
      code: "OPERATION_CONFLICT",
    });
  });

  it("maps persistence failures without retaining diagnostics", async () => {
    const gateway = persistence();
    const operations = createMemoryOperations(
      { individualId: "alice", capabilities: { read: true, write: true } },
      gateway,
    );
    for (const method of Object.values(gateway))
      method.mockRejectedValue(new PersistenceFault());
    for (const result of [
      await operations.commit(command),
      await operations.inspect({ memoryId: "memory" }),
      await operations.list({}),
      await operations.search({ query: "Synthetic" }),
    ])
      expect(result).toEqual({ ok: false, code: "UNAVAILABLE" });
  });
});

describe("Memory search invariants", () => {
  it("rejects invalid text, bounds, and mismatched cursors before opening a transaction", () => {
    const within = vi.fn(() => {
      throw new Error("Must not enter a transaction");
    });
    const search = createSearchMemories({ within });
    for (const query of ["", " \n\t", "x".repeat(201), "a\u0000b"])
      expect(search.execute({ query })).toEqual({
        ok: false,
        code: "INVALID_INPUT",
      });
    for (const limit of [0, 51, NaN, Infinity, 1.5])
      expect(search.execute({ query: "text", limit })).toEqual({
        ok: false,
        code: "INVALID_INPUT",
      });
    for (const cursor of [
      { query: "other", snapshotSequence: 1, afterSequence: 0 },
      { query: "text", snapshotSequence: -1, afterSequence: 0 },
      { query: "text", snapshotSequence: 1, afterSequence: 2 },
      { query: "text", snapshotSequence: 1, afterSequence: 0.5 },
      { query: "text", snapshotSequence: NaN, afterSequence: 0 },
    ])
      expect(search.execute({ query: "text", cursor })).toEqual({
        ok: false,
        code: "INVALID_INPUT",
      });
    expect(within).not.toHaveBeenCalled();
  });

  it("maps persistence failures without exposing provider diagnostics", () => {
    const search = createSearchMemories({
      within: () => {
        throw new PersistenceFault();
      },
    });
    expect(search.execute({ query: "text" })).toEqual({
      ok: false,
      code: "UNAVAILABLE",
    });
  });

  it("detaches queries and search pages and keeps storage identities private", async () => {
    const gateway = persistence();
    const cursor = { query: "text", snapshotSequence: 3, afterSequence: 1 };
    const stored = {
      individualId: "native-owner",
      changeSequence: 3,
      memories: [
        {
          memoryId: "memory",
          revision: 1,
          recordedAt: "2026-10-01T00:00:00Z",
          changeSequence: 2,
          preview: "text",
          body: "private full body",
        },
      ],
      nextCursor: { ...cursor, afterSequence: 2 },
    };
    gateway.search.mockImplementation(async (individualId, input) => {
      expect(individualId).toBe("alice");
      expect(input.cursor).toEqual(cursor);
      expect(input.cursor).not.toBe(cursor);
      return { ok: true, value: stored };
    });
    const operations = createMemoryOperations(
      { individualId: "alice", capabilities: { read: true, write: false } },
      gateway,
    );
    const result = await operations.search({ query: "text", cursor });
    stored.memories[0]!.preview = "Changed";
    stored.nextCursor.afterSequence = 3;
    expect(result).toMatchObject({
      ok: true,
      value: {
        individualId: "alice",
        memories: [{ preview: "text" }],
        nextCursor: { afterSequence: 2 },
      },
    });
    expect(JSON.stringify(result)).not.toContain("native-owner");
    expect(JSON.stringify(result)).not.toContain("private full body");
  });
});

describe("Memory pagination invariants", () => {
  it("validates page bounds before starting a Unit of Work", () => {
    const within = vi.fn(() => {
      throw new Error("Invalid pagination must not open a transaction");
    });
    const list = createListMemories({ within });
    for (const query of [
      { limit: 0 },
      { limit: 51 },
      { limit: NaN },
      { limit: 1.5 },
      { cursor: { snapshotSequence: -1, afterSequence: 0 } },
      { cursor: { snapshotSequence: 3, afterSequence: 4 } },
      { cursor: { snapshotSequence: 3, afterSequence: 0.5 } },
    ])
      expect(list.execute(query)).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(within).not.toHaveBeenCalled();
  });

  it("maps persistence faults during pagination", () => {
    const list = createListMemories({
      within: () => {
        throw new PersistenceFault();
      },
    });
    expect(list.execute({})).toEqual({ ok: false, code: "UNAVAILABLE" });
  });
});
