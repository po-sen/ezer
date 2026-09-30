import { env, exports } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { MemoryWrite } from "../src/memory/inboundport/commit-memory";
import { migrateMemory } from "../src/memory/infrastructure/persistence/sqlite/migrate-memory";
import { initializeIndividual } from "../src/memory/infrastructure/persistence/sqlite/initialize-individual";

function individual() {
  return env.EZER_MEMORY.get(env.EZER_MEMORY.newUniqueId());
}

function remember(
  memoryId = "preference",
  operationId = "remember-1",
): MemoryWrite {
  return {
    kind: "remember",
    memoryId,
    operationId,
    body: "The preferred meeting time is 09:00.",
    source: {
      reference: "conversation:synthetic:1",
      excerpt: "Please meet at 09:00.",
    },
  };
}

function revise(
  operationId = "revise-1",
  body = "The preferred meeting time is 10:00.",
): MemoryWrite {
  return {
    ...remember(),
    kind: "revise",
    operationId,
    expectedRevision: 1,
    body,
    source: {
      reference: "conversation:synthetic:2",
      excerpt: "Change the meeting to 10:00.",
    },
    reason: "A later statement corrects the original time.",
  };
}

describe("persistent memory through the internal Durable Object binding", () => {
  it("stores a source with its revision and recovers identity, history, and receipts after eviction", async () => {
    const alice = individual();
    const first = await alice.commit(remember());
    const second = await alice.commit(revise());
    expect(first).toMatchObject({
      ok: true,
      value: { revision: 1, changeSequence: 1 },
    });
    expect(second).toMatchObject({
      ok: true,
      value: { revision: 2, changeSequence: 2 },
    });
    const latest = await alice.inspect({ memoryId: "preference" });
    const original = await alice.inspect({
      memoryId: "preference",
      revision: 1,
    });
    expect(latest).toMatchObject({
      ok: true,
      value: {
        individualId: alice.id.toString(),
        changeSequence: 2,
        memory: {
          body: revise().body,
          source: revise().source,
          reason: "A later statement corrects the original time.",
          revision: 2,
          changeSequence: 2,
        },
      },
    });
    expect(original).toMatchObject({
      ok: true,
      value: {
        changeSequence: 2,
        memory: {
          body: remember().body,
          source: remember().source,
          revision: 1,
          changeSequence: 1,
          reason: null,
        },
      },
    });

    await evictDurableObject(alice);
    const reconnected = env.EZER_MEMORY.get(alice.id);
    expect(await reconnected.inspect({ memoryId: "preference" })).toEqual(
      latest,
    );
    expect(
      await reconnected.inspect({ memoryId: "preference", revision: 1 }),
    ).toEqual(original);
    // Simulate a committed write whose response was lost, including later edits.
    expect(await reconnected.commit(remember())).toEqual(first);
    expect(await reconnected.commit(revise())).toEqual(second);
    expect(
      await reconnected.commit(remember("another", "remember-2")),
    ).toMatchObject({
      ok: true,
      value: { changeSequence: 3 },
    });
  });

  it("keeps equal memory and operation IDs independent across individuals", async () => {
    const alice = individual();
    const bob = individual();
    await alice.commit(remember());
    expect(await bob.inspect({ memoryId: "preference" })).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(await bob.inspect({ memoryId: "preference", revision: 1 })).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(await bob.commit(revise())).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    const bobWrite = { ...remember(), body: "Bob prefers 14:00." };
    expect(await bob.commit(bobWrite)).toMatchObject({
      ok: true,
      value: { individualId: bob.id.toString(), changeSequence: 1 },
    });
    expect(await alice.inspect({ memoryId: "preference" })).toMatchObject({
      ok: true,
      value: { memory: { body: remember().body } },
    });
    expect(await bob.inspect({ memoryId: "preference" })).toMatchObject({
      ok: true,
      value: { memory: { body: bobWrite.body } },
    });
  });

  it("commits a concurrent retry only once and ignores JSON property order", async () => {
    const alice = individual();
    const request = remember();
    const receipts = await Promise.all(
      Array.from({ length: 8 }, () => alice.commit(request)),
    );
    expect(
      receipts.every(
        (receipt) => JSON.stringify(receipt) === JSON.stringify(receipts[0]),
      ),
    ).toBe(true);
    expect(receipts[0]).toMatchObject({
      ok: true,
      value: { changeSequence: 1 },
    });
    const reordered: MemoryWrite = {
      source: {
        excerpt: request.source.excerpt,
        reference: request.source.reference,
      },
      body: request.body,
      memoryId: request.memoryId,
      operationId: request.operationId,
      kind: "remember",
    };
    expect(await alice.commit(reordered)).toEqual(receipts[0]);
    await runInDurableObject(alice, (_instance, state) => {
      expect(
        state.storage.sql.exec("SELECT * FROM revisions").toArray(),
      ).toHaveLength(1);
      expect(
        state.storage.sql.exec("SELECT * FROM operations").toArray(),
      ).toHaveLength(1);
    });
  });

  it("rejects reuse of an operation ID when any write content changes", async () => {
    const alice = individual();
    const request = remember();
    const receipt = await alice.commit(request);
    for (const changed of [
      { ...request, body: "A different body." },
      { ...request, memoryId: "different" },
      { ...request, source: { ...request.source, reference: "different" } },
      {
        ...request,
        source: { ...request.source, excerpt: "Different source statement." },
      },
      revise(request.operationId),
    ]) {
      expect(await alice.commit(changed)).toEqual({
        ok: false,
        code: "OPERATION_CONFLICT",
      });
    }
    const revision = revise();
    await alice.commit(revision);
    expect(
      await alice.commit({
        ...revision,
        kind: "revise",
        expectedRevision: 2,
        reason: "Another reason.",
      }),
    ).toEqual({
      ok: false,
      code: "OPERATION_CONFLICT",
    });
    expect(await alice.commit(request)).toEqual(receipt);
  });

  it("allows only one concurrent correction of the same expected version", async () => {
    const alice = individual();
    await alice.commit(remember());
    const otherConnection = env.EZER_MEMORY.get(alice.id);
    const requests = [
      revise("edit-a", "A changed time."),
      revise("edit-b", "Another changed time."),
    ];
    const results = await Promise.all([
      alice.commit(requests[0]!),
      otherConnection.commit(requests[1]!),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      { ok: false, code: "REVISION_CONFLICT" },
    ]);
    const winner = results.findIndex((result) => result.ok);
    expect(await alice.inspect({ memoryId: "preference" })).toMatchObject({
      ok: true,
      value: {
        changeSequence: 2,
        memory: { revision: 2, body: requests[winner]!.body },
      },
    });
    expect(await alice.commit(requests[winner]!)).toEqual(results[winner]);
    expect(
      await alice.inspect({ memoryId: "preference", revision: 3 }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    // A rejected write consumes neither a sequence number nor its operation ID.
    const loser = requests[1 - winner]!;
    expect(
      await alice.commit({
        ...loser,
        kind: "revise",
        expectedRevision: 2,
        reason: "Rebased correction.",
      }),
    ).toMatchObject({
      ok: true,
      value: { revision: 3, changeSequence: 3 },
    });
  });

  it("serializes distinct writes and rejects racing creates with different operation IDs", async () => {
    const alice = individual();
    const creates = await Promise.all([
      alice.commit(remember()),
      alice.commit(remember("preference", "other-create")),
    ]);
    expect(creates.filter((result) => result.ok)).toHaveLength(1);
    expect(creates.filter((result) => !result.ok)).toEqual([
      { ok: false, code: "ALREADY_EXISTS" },
    ]);
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        alice.commit(remember(`item-${index}`, `op-${index}`)),
      ),
    );
    const sequences = results
      .map((result) => {
        expect(result.ok).toBe(true);
        return result.ok ? result.value.changeSequence : 0;
      })
      .sort((left, right) => left - right);
    expect(sequences).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("atomically rolls back the revision and sequence when receipt storage fails", async () => {
    const alice = individual();
    await alice.inspect({ memoryId: "missing" });
    await runInDurableObject(alice, (_instance, state) => {
      state.storage.sql
        .exec(`CREATE TRIGGER fail_operation BEFORE INSERT ON operations
        BEGIN SELECT RAISE(ABORT, 'synthetic receipt failure'); END;`);
    });
    expect(await alice.commit(remember())).toEqual({
      ok: false,
      code: "UNAVAILABLE",
    });
    expect(await alice.inspect({ memoryId: "preference" })).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    await runInDurableObject(alice, (_instance, state) => {
      expect(
        state.storage.sql.exec("SELECT change_sequence FROM state").one(),
      ).toEqual({ change_sequence: 0 });
      expect(
        state.storage.sql.exec("SELECT * FROM operations").toArray(),
      ).toEqual([]);
      state.storage.sql.exec("DROP TRIGGER fail_operation");
    });
    expect(await alice.commit(remember())).toMatchObject({
      ok: true,
      value: { revision: 1, changeSequence: 1 },
    });
  });

  it("preserves text exactly and binds values instead of interpolating SQL", async () => {
    const alice = individual();
    const text = "  '); DROP TABLE revisions; --\n\u2603 \u{1f642}  ";
    const request = {
      ...remember(),
      body: text,
      source: { reference: text, excerpt: text },
    };
    await alice.commit(request);
    expect(await alice.inspect({ memoryId: "preference" })).toMatchObject({
      ok: true,
      value: { memory: { body: text, source: request.source } },
    });
    expect(await alice.commit(remember("other", "op-2"))).toMatchObject({
      ok: true,
      value: { changeSequence: 2 },
    });
  });

  it("rejects malformed, oversized, or cross-individual input without creating records", async () => {
    const alice = individual();
    const base = remember();
    const invalid: unknown[] = [
      null,
      [],
      {},
      { ...base, kind: "delete" },
      { ...base, individualId: "bob" },
      { ...base, owner: "bob" },
      { ...base, memoryId: "../bob" },
      { ...base, operationId: "" },
      { ...base, memoryId: "a".repeat(129) },
      { ...base, body: " " },
      { ...base, body: "a".repeat(16_385) },
      { ...base, source: null },
      { ...base, source: { reference: "x" } },
      { ...base, source: { ...base.source, verified: true } },
      { ...base, source: { ...base.source, reference: "x".repeat(1_025) } },
      { ...base, source: { ...base.source, excerpt: "x".repeat(4_097) } },
      { ...base, expectedRevision: 1 },
      { ...revise(), reason: "" },
      { ...revise(), reason: "x".repeat(1_025) },
      { ...revise(), expectedRevision: 0 },
      { ...revise(), expectedRevision: 1.5 },
      { ...revise(), expectedRevision: Number.MAX_SAFE_INTEGER },
    ];
    for (const input of invalid) {
      expect(await alice.commit(input as MemoryWrite)).toEqual({
        ok: false,
        code: "INVALID_INPUT",
      });
    }
    await runInDurableObject(alice, (_instance, state) => {
      expect(
        state.storage.sql.exec("SELECT * FROM revisions").toArray(),
      ).toEqual([]);
      expect(
        state.storage.sql.exec("SELECT * FROM operations").toArray(),
      ).toEqual([]);
    });
    expect(await alice.commit(base)).toMatchObject({
      ok: true,
      value: { changeSequence: 1 },
    });
  });

  it("rejects selectors outside the bound individual and invalid revision numbers", async () => {
    const alice = individual();
    for (const input of [
      null,
      [],
      {},
      { memoryId: "x", individualId: "bob" },
      { memoryId: "../bob" },
      { memoryId: "x", revision: 0 },
      { memoryId: "x", revision: -1 },
      { memoryId: "x", revision: 1.5 },
      { memoryId: "x", revision: Number.MAX_SAFE_INTEGER + 1 },
    ]) {
      expect(await alice.inspect(input as { memoryId: string })).toEqual({
        ok: false,
        code: "INVALID_INPUT",
      });
    }
  });

  it("accepts the documented size limits and does not truncate source or correction text", async () => {
    const alice = individual();
    const request = {
      ...remember("m".repeat(128), "o".repeat(128)),
      body: "b".repeat(16_384),
      source: { reference: "r".repeat(1_024), excerpt: "e".repeat(4_096) },
    };
    expect(await alice.commit(request)).toMatchObject({ ok: true });
    const correction: MemoryWrite = {
      ...request,
      kind: "revise",
      operationId: "correction",
      expectedRevision: 1,
      reason: "r".repeat(1_024),
    };
    expect(await alice.commit(correction)).toMatchObject({ ok: true });
    expect(await alice.inspect({ memoryId: request.memoryId })).toMatchObject({
      ok: true,
      value: {
        memory: {
          body: request.body,
          source: request.source,
          reason: correction.reason,
        },
      },
    });
  });

  it("returns an unavailable result without exposing a database read failure", async () => {
    const alice = individual();
    await alice.commit(remember());
    await runInDurableObject(alice, (_instance, state) => {
      state.storage.sql.exec(
        "ALTER TABLE revisions RENAME TO unavailable_revisions",
      );
    });
    expect(await alice.inspect({ memoryId: "preference" })).toEqual({
      ok: false,
      code: "UNAVAILABLE",
    });
  });

  it("refuses a mismatched identity or unknown schema without changing stored records", async () => {
    const alice = individual();
    await alice.commit(remember());
    const before = await alice.inspect({ memoryId: "preference" });
    await runInDurableObject(alice, (_instance, state) => {
      expect(() =>
        initializeIndividual(state.storage, "another-individual"),
      ).toThrow("identity mismatch");
      state.storage.kv.put("memory:schema-version", 2);
      expect(() => migrateMemory(state.storage)).toThrow(
        "Unsupported memory schema",
      );
      expect(state.storage.kv.get("memory:schema-version")).toEqual(2);
      state.storage.kv.put("memory:schema-version", 1);
    });
    await evictDurableObject(alice);
    expect(await alice.inspect({ memoryId: "preference" })).toEqual(before);
  });

  it("does not expose the internal memory binding through public HTTP routes", async () => {
    for (const path of [
      "/memory",
      "/memory/commit",
      "/memory/inspect",
      "/individuals/alice",
    ]) {
      const response = await exports.default.fetch(`https://ezer.test${path}`, {
        method: "POST",
        body: JSON.stringify(remember()),
      });
      expect(response.status).toBe(404);
    }
  });
});
