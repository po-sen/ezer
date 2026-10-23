import { describe, expect, it, vi } from "vitest";
import {
  createListMemories,
  createSearchMemories,
  createMemoryOperations,
  createExportMemoryHistory,
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
    restoreHistory: vi.fn<MemoryPersistence["restoreHistory"]>(async () => ({
      ok: false,
      code: "RESTORE_NOT_GRANTED",
    })),
    exportHistory: vi.fn<MemoryPersistence["exportHistory"]>(async () => ({
      ok: false,
      code: "NOT_FOUND",
    })),
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
  it("detaches restore requests, rejects foreign identities before persistence, and preserves the captured grant", async () => {
    const gateway = persistence();
    const connection = {
      individualId: "alice",
      capabilities: { read: false, write: false, restore: true },
    };
    const operations = createMemoryOperations(connection, gateway);
    connection.capabilities.restore = false;
    connection.individualId = "bob";
    const input = {
      restoreId: "one",
      page: {
        format: "ezer-memory" as const,
        formatVersion: 1 as const,
        individualId: "alice",
        snapshotSequence: 1,
        revisions: [
          {
            individualId: "alice",
            memoryId: "memory",
            revision: 1,
            body: "Original",
            source: { reference: "test:original", excerpt: "Evidence" },
            reason: null,
            recordedAt: "2026-09-30T00:00:00.000Z",
            changeSequence: 1,
          },
        ],
        nextCursor: null,
      },
    };
    gateway.restoreHistory.mockImplementation(async (id, submitted) => {
      input.page.revisions[0]!.body = "Mutated after submission";
      input.page.revisions[0]!.source.excerpt = "Mutated evidence";
      expect(id).toBe("alice");
      expect(submitted.revisions[0]).toMatchObject({
        body: "Original",
        source: { excerpt: "Evidence" },
      });
      expect(submitted.revisions[0]).not.toHaveProperty("individualId");
      return {
        ok: true,
        value: {
          restoreId: "one",
          snapshotSequence: 1,
          restoredSequence: 1,
          complete: true,
          privateOwner: "ignored",
        },
      };
    });
    expect(await operations.restoreHistory(input)).toEqual({
      ok: true,
      value: {
        restoreId: "one",
        snapshotSequence: 1,
        restoredSequence: 1,
        complete: true,
      },
    });
    gateway.restoreHistory.mockClear();
    expect(
      await operations.restoreHistory({
        ...input,
        page: { ...input.page, individualId: "bob" },
      }),
    ).toEqual({ ok: false, code: "IDENTITY_MISMATCH" });
    const denied = createMemoryOperations(
      {
        individualId: "alice",
        capabilities: { read: true, write: true, restore: false },
      },
      gateway,
    );
    expect(await denied.restoreHistory(input)).toEqual({
      ok: false,
      code: "RESTORE_NOT_GRANTED",
    });
    expect(gateway.restoreHistory).not.toHaveBeenCalled();
  });
  it("denies access before touching any persistence capability", async () => {
    const gateway = persistence();
    const operations = createMemoryOperations(
      {
        individualId: "alice",
        capabilities: { read: false, write: false, restore: false },
      },
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
    expect(await operations.exportHistory({})).toEqual({
      ok: false,
      code: "READ_NOT_GRANTED",
    });
    expect(await operations.list({ order: "newest" })).toEqual({
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
      capabilities: { read: true, write: false, restore: false },
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
        {
          individualId: "../bob",
          capabilities: { read: true, write: true, restore: false },
        },
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
      {
        individualId: "alice",
        capabilities: { read: true, write: true, restore: false },
      },
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
      {
        individualId: "alice",
        capabilities: { read: true, write: true, restore: false },
      },
      gateway,
    );
    for (const method of Object.values(gateway))
      method.mockRejectedValue(new PersistenceFault());
    for (const result of [
      await operations.commit(command),
      await operations.inspect({ memoryId: "memory" }),
      await operations.list({}),
      await operations.search({ query: "Synthetic" }),
      await operations.exportHistory({}),
    ])
      expect(result).toEqual({ ok: false, code: "UNAVAILABLE" });
  });
});

describe("Memory export invariants", () => {
  it("validates page bounds before reading storage and maps persistence failures", () => {
    const within = vi.fn(() => {
      throw new PersistenceFault();
    });
    const exporter = createExportMemoryHistory({ within });
    for (const query of [
      { limit: 0 },
      { limit: 11 },
      { limit: NaN },
      { limit: Infinity },
      { limit: 1.5 },
      { cursor: { snapshotSequence: -1, afterSequence: 0 } },
      { cursor: { snapshotSequence: NaN, afterSequence: 0 } },
      { cursor: { snapshotSequence: 2, afterSequence: Infinity } },
      { cursor: { snapshotSequence: 2, afterSequence: 3 } },
      { cursor: { snapshotSequence: 2, afterSequence: 0.5 } },
    ])
      expect(exporter.execute(query)).toEqual({
        ok: false,
        code: "INVALID_INPUT",
      });
    expect(within).not.toHaveBeenCalled();
    expect(exporter.execute({})).toEqual({ ok: false, code: "UNAVAILABLE" });
  });

  it("detaches export requests and full history while excluding storage-only fields", async () => {
    const gateway = persistence();
    const cursor = { snapshotSequence: 3, afterSequence: 1 };
    const revision = {
      individualId: "native-owner",
      memoryId: "memory",
      revision: 2,
      recordedAt: "2026-10-23T00:00:00Z",
      changeSequence: 2,
      body: "Corrected",
      source: { reference: "test:source", excerpt: "New evidence" },
      reason: "Correction",
      operationId: "private-operation",
    };
    const stored = {
      individualId: "native-owner",
      snapshotSequence: 3,
      revisions: [revision],
      nextCursor: { ...cursor, afterSequence: 2 },
    };
    gateway.exportHistory.mockImplementation(async (individualId, input) => {
      expect(individualId).toBe("alice");
      expect(input).toEqual({ limit: 1, cursor });
      expect(input.cursor).not.toBe(cursor);
      return { ok: true, value: stored };
    });
    const operations = createMemoryOperations(
      {
        individualId: "alice",
        capabilities: { read: true, write: false, restore: false },
      },
      gateway,
    );
    const result = await operations.exportHistory({ limit: 1, cursor });
    revision.body = "Changed";
    revision.source.excerpt = "Changed";
    stored.nextCursor.afterSequence = 3;
    expect(result).toEqual({
      ok: true,
      value: {
        format: "ezer-memory",
        formatVersion: 1,
        individualId: "alice",
        snapshotSequence: 3,
        revisions: [
          {
            individualId: "alice",
            memoryId: "memory",
            revision: 2,
            recordedAt: "2026-10-23T00:00:00Z",
            changeSequence: 2,
            body: "Corrected",
            source: { reference: "test:source", excerpt: "New evidence" },
            reason: "Correction",
          },
        ],
        nextCursor: { snapshotSequence: 3, afterSequence: 2 },
      },
    });
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
      {
        individualId: "alice",
        capabilities: { read: true, write: false, restore: false },
      },
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
      {
        order: "oldest",
        cursor: { order: "newest", snapshotSequence: 3, afterSequence: 2 },
      },
      { order: "newest", cursor: { snapshotSequence: 3, afterSequence: 2 } },
    ] as const)
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

  it("preserves ordering in detached list requests and pages", async () => {
    const gateway = persistence();
    const cursor = {
      order: "newest" as const,
      snapshotSequence: 3,
      afterSequence: 3,
    };
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
    gateway.list.mockImplementation(async (individualId, input) => {
      expect(individualId).toBe("alice");
      expect(input).toEqual({ order: "newest", cursor });
      expect(input.cursor).not.toBe(cursor);
      return { ok: true, value: stored };
    });
    const operations = createMemoryOperations(
      {
        individualId: "alice",
        capabilities: { read: true, write: false, restore: false },
      },
      gateway,
    );
    const result = await operations.list({ order: "newest", cursor });
    stored.nextCursor.afterSequence = 1;
    stored.memories[0]!.preview = "Changed";
    expect(result).toMatchObject({
      ok: true,
      value: {
        individualId: "alice",
        memories: [{ preview: "text" }],
        nextCursor: { order: "newest", snapshotSequence: 3, afterSequence: 2 },
      },
    });
    expect(JSON.stringify(result)).not.toContain("native-owner");
    expect(JSON.stringify(result)).not.toContain("private full body");
  });
});
