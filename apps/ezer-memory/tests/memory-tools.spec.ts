import { env } from "cloudflare:workers";
import { evictDurableObject } from "cloudflare:test";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { createTestAuthority } from "./authorization/index.ts";

afterEach(() => vi.restoreAllMocks());
const all = "ezer:connect ezer:memory:read ezer:memory:write";
function memory(memoryId: string, operationId = `save-${memoryId}`) {
  return {
    memoryId,
    operationId,
    body: `Synthetic memory ${memoryId}`,
    source: {
      reference: "test:conversation",
      excerpt: "Synthetic source evidence",
    },
  };
}
function value(result: Awaited<ReturnType<Client["callTool"]>>) {
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toBeDefined();
  return result.structuredContent as Record<string, unknown>;
}
function failure(
  result: Awaited<ReturnType<Client["callTool"]>>,
  code: string,
) {
  expect(result.isError).toBe(true);
  expect(result.content).toEqual([{ type: "text", text: code }]);
  expect(result.structuredContent).toBeUndefined();
}
async function harness() {
  // This authority creates ephemeral synthetic signing keys, never user credentials.
  const authority = await createTestAuthority();
  const alice = `alice-${crypto.randomUUID()}`;
  const bob = `bob-${crypto.randomUUID()}`;
  const policy = {
    ...authority.policy,
    bindings: [
      { subject: "alice", individualId: alice },
      { subject: "alias", individualId: alice },
      { subject: "bob", individualId: bob },
    ],
  };
  return {
    alice,
    bob,
    policy,
    authority,
    async client(scope = all, subject = "alice") {
      const token = await authority.sign({
        scope,
        sub: subject,
        individual_id: bob,
      });
      const client = new Client({
        name: `synthetic-${crypto.randomUUID()}`,
        version: "1.0.0",
      });
      onTestFinished(() => client.close());
      await client.connect(
        new StreamableHTTPClientTransport(new URL(policy.resource), {
          fetch: (input, init) => {
            const request = new Request(input, init);
            request.headers.set("Authorization", `Bearer ${token}`);
            request.headers.set("X-Ezer-Id", bob);
            return authority.request(request, policy);
          },
        }),
      );
      return client;
    },
  };
}

describe("scoped memory MCP operations", () => {
  it("searches complete bodies with literal multilingual text beyond the first listing page", async () => {
    const h = await harness();
    const client = await h.client();
    for (let i = 0; i < 12; i++)
      value(
        await client.callTool({
          name: "ezer_remember",
          arguments: memory(`earlier-${i}`),
        }),
      );
    const body = `${"Prefix ".repeat(30)}Coffee \u7e41\u9ad4\u4e2d\u6587 100%_ ' OR 1=1 -- CAFÉ`;
    value(
      await client.callTool({
        name: "ezer_remember",
        arguments: { ...memory("match"), body },
      }),
    );
    await evictDurableObject(env.EZER_MEMORY.getByName(`ezer:v1:${h.alice}`));
    const reader = await h.client("ezer:connect ezer:memory:read", "alias");
    for (const query of [
      "coffee",
      "COFFEE",
      "\u7e41",
      "\u7e41\u9ad4\u4e2d\u6587",
      "%_",
      "' OR 1=1 --",
      "CAFÉ",
      "coff",
    ])
      expect(
        value(
          await reader.callTool({ name: "ezer_search", arguments: { query } }),
        ),
      ).toMatchObject({
        individualId: h.alice,
        memories: [
          { memoryId: "match", revision: 1, preview: body.slice(0, 160) },
        ],
        nextCursor: null,
      });
    for (const query of [
      "café",
      "source evidence",
      "test:conversation",
      "coffee OR tea",
      "Coffee  ",
    ])
      expect(
        value(
          await reader.callTool({ name: "ezer_search", arguments: { query } }),
        ).memories,
      ).toEqual([]);
    const other = await h.client(all, "bob");
    expect(
      value(
        await other.callTool({
          name: "ezer_search",
          arguments: { query: "coffee" },
        }),
      ).memories,
    ).toEqual([]);
    const searchResult = value(
      await reader.callTool({
        name: "ezer_search",
        arguments: { query: "coffee" },
      }),
    );
    expect(JSON.stringify(searchResult)).not.toContain(
      env.EZER_MEMORY.idFromName(`ezer:v1:${h.alice}`).toString(),
    );
    expect(
      value(
        await reader.callTool({
          name: "ezer_read",
          arguments: { memoryId: "match", revision: 1 },
        }),
      ),
    ).toMatchObject({ memory: { body } });
  });

  it("pages only latest-at-snapshot matches and starts a fresh search after corrections", async () => {
    const h = await harness();
    const client = await h.client();
    for (const id of ["first", "second", "third"])
      value(
        await client.callTool({
          name: "ezer_remember",
          arguments: { ...memory(id), body: `tea ${id}` },
        }),
      );
    const first = value(
      await client.callTool({
        name: "ezer_search",
        arguments: { query: "tea", limit: 1 },
      }),
    );
    expect(first).toMatchObject({
      changeSequence: 3,
      memories: [{ memoryId: "first" }],
      nextCursor: { query: "tea", snapshotSequence: 3, afterSequence: 1 },
    });
    for (const id of ["second", "third"])
      value(
        await client.callTool({
          name: "ezer_revise",
          arguments: {
            ...memory(id, `correct-${id}`),
            body: id === "second" ? "coffee" : "tea revised",
            expectedRevision: 1,
            reason: "Synthetic correction",
          },
        }),
      );
    value(
      await client.callTool({
        name: "ezer_remember",
        arguments: { ...memory("fourth"), body: "tea new" },
      }),
    );
    const second = value(
      await client.callTool({
        name: "ezer_search",
        arguments: { query: "tea", limit: 1, cursor: first.nextCursor },
      }),
    );
    expect(second).toMatchObject({
      changeSequence: 3,
      memories: [{ memoryId: "second", revision: 1 }],
      nextCursor: { query: "tea", snapshotSequence: 3, afterSequence: 2 },
    });
    const third = value(
      await client.callTool({
        name: "ezer_search",
        arguments: { query: "tea", limit: 1, cursor: second.nextCursor },
      }),
    );
    expect(third).toMatchObject({
      changeSequence: 3,
      memories: [{ memoryId: "third", revision: 1 }],
      nextCursor: null,
    });
    expect(
      value(
        await client.callTool({
          name: "ezer_read",
          arguments: { memoryId: "second", revision: 1 },
        }),
      ),
    ).toMatchObject({ memory: { body: "tea second" } });
    const current = value(
      await client.callTool({
        name: "ezer_search",
        arguments: { query: "tea" },
      }),
    );
    expect(current).toMatchObject({
      changeSequence: 6,
      memories: [
        { memoryId: "first", revision: 1 },
        { memoryId: "third", revision: 2 },
        { memoryId: "fourth", revision: 1 },
      ],
      nextCursor: null,
    });
    failure(
      await client.callTool({
        name: "ezer_search",
        arguments: { query: "coffee", cursor: first.nextCursor },
      }),
      "INVALID_INPUT",
    );
    const other = await h.client(all, "bob");
    for (const id of ["a", "b", "c"])
      value(
        await other.callTool({
          name: "ezer_remember",
          arguments: { ...memory(id), body: "tea other individual" },
        }),
      );
    const isolated = value(
      await other.callTool({
        name: "ezer_search",
        arguments: { query: "tea", cursor: first.nextCursor },
      }),
    );
    expect(isolated).toMatchObject({
      individualId: h.bob,
      memories: [{ memoryId: "b" }, { memoryId: "c" }],
    });
    expect(JSON.stringify(isolated)).not.toContain(h.alice);
  });

  it("bounds search input at MCP and RPC and reports an empty search honestly", async () => {
    const h = await harness();
    const client = await h.client();
    expect(
      value(
        await client.callTool({
          name: "ezer_search",
          arguments: { query: "absent" },
        }),
      ),
    ).toMatchObject({ changeSequence: 0, memories: [], nextCursor: null });
    for (const input of [
      {},
      { query: "" },
      { query: " \t" },
      { query: "x".repeat(201) },
      { query: "a\u0000b" },
      { query: "x", limit: 0 },
      { query: "x", limit: 51 },
      { query: "x", limit: 1.5 },
      { query: "x", individualId: h.bob },
      {
        query: "x",
        cursor: { query: "x", snapshotSequence: 1, afterSequence: 0 },
      },
      {
        query: "x",
        cursor: { query: "x", snapshotSequence: 0, afterSequence: 1 },
      },
      { query: "x", cursor: { snapshotSequence: 0, afterSequence: 0 } },
    ]) {
      expect(
        (await client.callTool({ name: "ezer_search", arguments: input }))
          .isError,
      ).toBe(true);
      expect(
        await env.EZER_MEMORY.getByName(`ezer:v1:${h.alice}`).search(input),
      ).toEqual({ ok: false, code: "INVALID_INPUT" });
    }
    expect(
      value(
        await client.callTool({
          name: "ezer_search",
          arguments: { query: "x".repeat(200), limit: 50 },
        }),
      ).memories,
    ).toEqual([]);
  });

  it("persists sourced memories across independent clients and eviction without leaking native IDs", async () => {
    const h = await harness();
    const writer = await h.client();
    const saved = value(
      await writer.callTool({
        name: "ezer_remember",
        arguments: memory("plan"),
      }),
    );
    expect(saved).toMatchObject({
      individualId: h.alice,
      memoryId: "plan",
      revision: 1,
      changeSequence: 1,
    });
    await evictDurableObject(env.EZER_MEMORY.getByName(`ezer:v1:${h.alice}`));
    const reader = await h.client("ezer:connect ezer:memory:read", "alias");
    const found = value(
      await reader.callTool({
        name: "ezer_read",
        arguments: { memoryId: "plan" },
      }),
    );
    expect(found).toMatchObject({
      individualId: h.alice,
      changeSequence: 1,
      memory: {
        ...saved,
        body: memory("plan").body,
        source: memory("plan").source,
        reason: null,
      },
    });
    const listed = value(
      await reader.callTool({ name: "ezer_list", arguments: {} }),
    );
    expect(listed).toMatchObject({
      individualId: h.alice,
      changeSequence: 1,
      memories: [
        { memoryId: "plan", revision: 1, preview: memory("plan").body },
      ],
      nextCursor: null,
    });
    const nativeId = env.EZER_MEMORY.idFromName(
      `ezer:v1:${h.alice}`,
    ).toString();
    expect(JSON.stringify([saved, found, listed])).not.toContain(nativeId);
    const other = await h.client(all, "bob");
    failure(
      await other.callTool({
        name: "ezer_read",
        arguments: { memoryId: "plan" },
      }),
      "NOT_FOUND",
    );
    expect(
      value(await other.callTool({ name: "ezer_list", arguments: {} }))
        .memories,
    ).toEqual([]);
    const separate = value(
      await other.callTool({
        name: "ezer_remember",
        arguments: memory("plan"),
      }),
    );
    expect(separate).toMatchObject({
      individualId: h.bob,
      revision: 1,
      changeSequence: 1,
    });
  });

  it("enforces connect-only, read-only, and write-only grants independently", async () => {
    const h = await harness();
    const writer = await h.client("ezer:connect ezer:memory:write");
    value(
      await writer.callTool({
        name: "ezer_remember",
        arguments: memory("private"),
      }),
    );
    for (const scope of [
      "ezer:connect",
      "ezer:connect ezer:memory:read-other ezer:memory:write-other",
    ]) {
      const client = await h.client(scope);
      value(await client.callTool({ name: "ezer_identity", arguments: {} }));
      failure(
        await client.callTool({
          name: "ezer_read",
          arguments: { memoryId: "private" },
        }),
        "READ_NOT_GRANTED",
      );
      failure(
        await client.callTool({ name: "ezer_list", arguments: {} }),
        "READ_NOT_GRANTED",
      );
      failure(
        await client.callTool({
          name: "ezer_search",
          arguments: { query: "private" },
        }),
        "READ_NOT_GRANTED",
      );
      failure(
        await client.callTool({
          name: "ezer_remember",
          arguments: memory("denied"),
        }),
        "WRITE_NOT_GRANTED",
      );
      failure(
        await client.callTool({
          name: "ezer_revise",
          arguments: {
            ...memory("private", "revise"),
            expectedRevision: 1,
            reason: "Correction",
          },
        }),
        "WRITE_NOT_GRANTED",
      );
    }
    failure(
      await writer.callTool({
        name: "ezer_read",
        arguments: { memoryId: "private" },
      }),
      "READ_NOT_GRANTED",
    );
    failure(
      await writer.callTool({ name: "ezer_list", arguments: {} }),
      "READ_NOT_GRANTED",
    );
    failure(
      await writer.callTool({
        name: "ezer_search",
        arguments: { query: "private" },
      }),
      "READ_NOT_GRANTED",
    );
    const reader = await h.client("ezer:connect ezer:memory:read");
    value(
      await reader.callTool({
        name: "ezer_read",
        arguments: { memoryId: "private" },
      }),
    );
    failure(
      await reader.callTool({
        name: "ezer_remember",
        arguments: memory("denied"),
      }),
      "WRITE_NOT_GRANTED",
    );
    failure(
      await reader.callTool({
        name: "ezer_revise",
        arguments: {
          ...memory("private", "revise"),
          expectedRevision: 1,
          reason: "Correction",
        },
      }),
      "WRITE_NOT_GRANTED",
    );
    expect(
      value(await reader.callTool({ name: "ezer_identity", arguments: {} }))
        .changeSequence,
    ).toBe(1);
    const onlyContent = await h.authority.sign({
      scope: "ezer:memory:read ezer:memory:write",
    });
    expect(
      (
        await h.authority.request(
          new Request(h.policy.resource, {
            method: "POST",
            headers: { Authorization: `Bearer ${onlyContent}` },
          }),
          h.policy,
        )
      ).status,
    ).toBe(403);
  });

  it("rechecks assignments after a client connects", async () => {
    const h = await harness();
    const writer = await h.client();
    value(
      await writer.callTool({
        name: "ezer_remember",
        arguments: memory("initial"),
      }),
    );
    h.policy.bindings = h.policy.bindings.filter(
      (binding) => binding.subject !== "alice",
    );
    await expect(
      writer.callTool({ name: "ezer_remember", arguments: memory("revoked") }),
    ).rejects.toThrow();
    const alias = await h.client(all, "alias");
    expect(
      value(await alias.callTool({ name: "ezer_list", arguments: {} }))
        .memories,
    ).toHaveLength(1);
  });

  it("preserves retry receipts and immutable revisions with one concurrent correction winner", async () => {
    const h = await harness();
    const first = await h.client();
    const second = await h.client(all, "alias");
    const input = memory("schedule");
    const saved = value(
      await first.callTool({ name: "ezer_remember", arguments: input }),
    );
    expect(
      value(await second.callTool({ name: "ezer_remember", arguments: input })),
    ).toEqual(saved);
    failure(
      await first.callTool({
        name: "ezer_remember",
        arguments: { ...input, body: "Changed retry" },
      }),
      "OPERATION_CONFLICT",
    );
    failure(
      await first.callTool({
        name: "ezer_remember",
        arguments: memory("schedule", "another-create"),
      }),
      "ALREADY_EXISTS",
    );
    const corrected = {
      ...memory("schedule", "correct-a"),
      expectedRevision: 1,
      reason: "A sourced correction",
      body: "New schedule",
    };
    const alternatives = await Promise.all([
      first.callTool({ name: "ezer_revise", arguments: corrected }),
      second.callTool({
        name: "ezer_revise",
        arguments: {
          ...corrected,
          operationId: "correct-b",
          body: "Alternative",
        },
      }),
    ]);
    expect(alternatives.filter((result) => !result.isError)).toHaveLength(1);
    failure(
      alternatives.find((result) => result.isError)!,
      "REVISION_CONFLICT",
    );
    expect(
      value(
        await second.callTool({
          name: "ezer_read",
          arguments: { memoryId: "schedule" },
        }),
      ),
    ).toMatchObject({
      changeSequence: 2,
      memory: { revision: 2, reason: corrected.reason },
    });
    expect(
      value(await first.callTool({ name: "ezer_remember", arguments: input })),
    ).toEqual(saved);
    expect(
      value(
        await first.callTool({
          name: "ezer_read",
          arguments: { memoryId: "schedule", revision: 1 },
        }),
      ),
    ).toMatchObject({
      memory: { body: input.body, revision: 1, reason: null },
    });
    failure(
      await first.callTool({
        name: "ezer_read",
        arguments: { memoryId: "schedule", revision: 3 },
      }),
      "NOT_FOUND",
    );
  });

  it("keeps stable latest-at-snapshot pages during later writes and corrections", async () => {
    const h = await harness();
    const client = await h.client();
    for (const id of ["a", "b", "c"])
      value(
        await client.callTool({ name: "ezer_remember", arguments: memory(id) }),
      );
    value(
      await client.callTool({
        name: "ezer_revise",
        arguments: {
          ...memory("a", "correct-a"),
          expectedRevision: 1,
          reason: "Correction",
          body: "A revised",
        },
      }),
    );
    const first = value(
      await client.callTool({ name: "ezer_list", arguments: { limit: 1 } }),
    );
    expect(first).toMatchObject({
      changeSequence: 4,
      memories: [{ memoryId: "b", revision: 1 }],
      nextCursor: { snapshotSequence: 4, afterSequence: 2 },
    });
    value(
      await client.callTool({
        name: "ezer_revise",
        arguments: {
          ...memory("c", "correct-c"),
          expectedRevision: 1,
          reason: "Later correction",
          body: "C revised",
        },
      }),
    );
    value(
      await client.callTool({ name: "ezer_remember", arguments: memory("d") }),
    );
    await evictDurableObject(env.EZER_MEMORY.getByName(`ezer:v1:${h.alice}`));
    const second = value(
      await client.callTool({
        name: "ezer_list",
        arguments: { limit: 1, cursor: first.nextCursor },
      }),
    );
    expect(second).toMatchObject({
      changeSequence: 4,
      memories: [{ memoryId: "c", revision: 1, preview: memory("c").body }],
    });
    const last = value(
      await client.callTool({
        name: "ezer_list",
        arguments: { limit: 1, cursor: second.nextCursor },
      }),
    );
    expect(last).toMatchObject({
      changeSequence: 4,
      memories: [{ memoryId: "a", revision: 2 }],
      nextCursor: null,
    });
    expect(
      value(await client.callTool({ name: "ezer_list", arguments: {} })),
    ).toMatchObject({
      changeSequence: 6,
      memories: [
        { memoryId: "b", revision: 1 },
        { memoryId: "a", revision: 2 },
        { memoryId: "c", revision: 2 },
        { memoryId: "d", revision: 1 },
      ],
      nextCursor: null,
    });
    const other = await h.client(all, "bob");
    failure(
      await other.callTool({
        name: "ezer_list",
        arguments: { cursor: first.nextCursor },
      }),
      "INVALID_INPUT",
    );
    expect(
      value(await other.callTool({ name: "ezer_list", arguments: {} }))
        .memories,
    ).toEqual([]);
  });

  it("bounds pages and previews and rejects selectors, malformed cursors, and invalid writes", async () => {
    const h = await harness();
    const client = await h.client();
    for (let i = 0; i < 11; i++)
      value(
        await client.callTool({
          name: "ezer_remember",
          arguments: { ...memory(`record-${i}`), body: "x".repeat(200) },
        }),
      );
    const page = value(
      await client.callTool({ name: "ezer_list", arguments: {} }),
    );
    expect(page.memories).toHaveLength(10);
    expect(page.memories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ preview: "x".repeat(160) }),
      ]),
    );
    for (const args of [
      { limit: 0 },
      { limit: 51 },
      { limit: 1.5 },
      { cursor: { snapshotSequence: 12, afterSequence: 0 } },
      { cursor: { snapshotSequence: 5, afterSequence: 6 } },
      { cursor: { snapshotSequence: -1, afterSequence: 0 } },
      {
        cursor: { snapshotSequence: 5, afterSequence: 0, individualId: h.bob },
      },
      { individualId: h.bob },
    ]) {
      expect(
        (await client.callTool({ name: "ezer_list", arguments: args })).isError,
      ).toBe(true);
    }
    for (const [name, args] of [
      ["ezer_remember", { ...memory("bad"), individualId: h.bob }],
      ["ezer_remember", { ...memory("bad"), body: " " }],
      [
        "ezer_remember",
        { ...memory("bad"), source: { reference: "test", excerpt: "" } },
      ],
      ["ezer_remember", { ...memory("bad"), body: "x".repeat(16_385) }],
      ["ezer_read", { memoryId: "record-0", owner: h.bob }],
      ["ezer_read", { memoryId: "record-0", revision: 0 }],
      [
        "ezer_revise",
        {
          ...memory("record-0", "bad-revise"),
          expectedRevision: 1,
          reason: "",
        },
      ],
    ] as const)
      expect((await client.callTool({ name, arguments: args })).isError).toBe(
        true,
      );
    expect(
      value(await client.callTool({ name: "ezer_identity", arguments: {} }))
        .changeSequence,
    ).toBe(11);
  });
});
