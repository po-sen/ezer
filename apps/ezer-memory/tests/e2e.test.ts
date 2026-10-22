import assert from "node:assert/strict";
import { test } from "node:test";
import { createAcceptanceFixture } from "./acceptance/index.ts";

test(
  "packaged HTTPS connections preserve memories across sessions and runtime restarts",
  { timeout: 60000 },
  async (t) => {
    const fixture = await createAcceptanceFixture();
    t.after(() => fixture.close());
    const first = await fixture.client("alpha");
    const saved = await first.callTool({
      name: "ezer_remember",
      arguments: {
        operationId: "save",
        memoryId: "preference",
        body: "Synthetic preference: amber tea.",
        source: {
          reference: "test:session-one",
          excerpt: "I prefer amber tea.",
        },
      },
    });
    assert.equal(saved.isError, undefined);
    await first.close();
    await fixture.restart();
    const second = await fixture.client("alpha");
    const page = await second.callTool({
      name: "ezer_list",
      arguments: { order: "newest" },
    });
    assert.equal(
      (page.structuredContent as Record<string, unknown>)?.individualId,
      "acceptance-alpha",
    );
    assert.deepEqual(
      (
        (page.structuredContent as Record<string, unknown>)?.memories as {
          memoryId: string;
          revision: number;
        }[]
      ).map(({ memoryId, revision }) => ({ memoryId, revision })),
      [{ memoryId: "preference", revision: 1 }],
    );
    const revised = await second.callTool({
      name: "ezer_revise",
      arguments: {
        operationId: "correct",
        memoryId: "preference",
        expectedRevision: 1,
        body: "Synthetic preference: violet tea.",
        source: {
          reference: "test:session-two",
          excerpt: "I now prefer violet tea.",
        },
        reason: "Updated preference",
      },
    });
    assert.equal(revised.isError, undefined);
    await second.close();
    const third = await fixture.client("alpha");
    const corrected = await third.callTool({
      name: "ezer_read",
      arguments: { memoryId: "preference", revision: 2 },
    });
    assert.equal(
      (
        (corrected.structuredContent as Record<string, unknown>)?.memory as {
          body: string;
        }
      ).body,
      "Synthetic preference: violet tea.",
    );
    const history = await third.callTool({
      name: "ezer_read",
      arguments: { memoryId: "preference", revision: 1 },
    });
    assert.equal(
      (
        (history.structuredContent as Record<string, unknown>)?.memory as {
          body: string;
        }
      ).body,
      "Synthetic preference: amber tea.",
    );
    const other = await fixture.client("beta");
    assert.deepEqual(
      (
        await other.callTool({
          name: "ezer_list",
          arguments: { order: "newest" },
        })
      ).structuredContent as Record<string, unknown>,
      {
        individualId: "acceptance-beta",
        changeSequence: 0,
        memories: [],
        nextCursor: null,
      },
    );
    assert.equal(
      (
        await other.callTool({
          name: "ezer_read",
          arguments: { memoryId: "preference" },
        })
      ).isError,
      true,
    );
    const denied = await fixture.client("connect-only");
    const denial = await denied.callTool({
      name: "ezer_list",
      arguments: { order: "newest" },
    });
    assert.equal(denial.isError, true);
    assert.deepEqual(denial.content, [
      { type: "text", text: "READ_NOT_GRANTED" },
    ]);
  },
);

test(
  "legacy MCP streams initialization and tolerates client disconnects",
  { timeout: 15000 },
  async (t) => {
    const fixture = await createAcceptanceFixture();
    t.after(() => fixture.close());
    const response = await fetch(fixture.instance("alpha").url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "legacy-acceptance", version: "1" },
        },
      }),
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 200);
    assert.match(
      response.headers.get("content-type") ?? "",
      /text\/event-stream/,
    );
    const reader = response.body!.getReader();
    let event = "";
    try {
      while (!event.includes("\n\n")) {
        const chunk = await reader.read();
        assert.ok(!chunk.done, "Initialization stream ended without an event");
        event += new TextDecoder().decode(chunk.value);
        assert.ok(event.length < 10000, "Unexpected initialization event size");
      }
    } finally {
      await reader.cancel();
    }
    const data = event.split("\n").find((line) => line.startsWith("data: "));
    assert.ok(data);
    assert.equal(
      JSON.parse(data.slice(6)).result.protocolVersion,
      "2025-06-18",
    );
    const next = await fixture.client("alpha");
    assert.equal(
      (await next.callTool({ name: "ezer_identity", arguments: {} })).isError,
      undefined,
    );
  },
);
