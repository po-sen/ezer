import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createAcceptanceFixture } from "./acceptance/index.ts";
import type {
  MemoryExportPage,
  MemoryInspection,
} from "../src/modules/memory/ports/inbound/index.ts";

test(
  "complete exports restore to the same identity in an independent empty runtime",
  { timeout: 60000 },
  async (t) => {
    const source = await createAcceptanceFixture();
    let target: Awaited<ReturnType<typeof createAcceptanceFixture>> | undefined;
    t.after(async () => {
      try {
        await target?.close();
      } finally {
        await source.close();
      }
    });
    const writer = await source.client("alpha");
    const content = {
      memoryId: "restore-me",
      source: { reference: "test:recovery", excerpt: "Synthetic evidence" },
    };
    assert.ok(
      !(
        await writer.callTool({
          name: "ezer_remember",
          arguments: { ...content, operationId: "one", body: "Original" },
        })
      ).isError,
    );
    assert.ok(
      !(
        await writer.callTool({
          name: "ezer_revise",
          arguments: {
            ...content,
            operationId: "two",
            expectedRevision: 1,
            body: "Corrected",
            reason: "New evidence",
          },
        })
      ).isError,
    );
    const first = (
      await writer.callTool({ name: "ezer_export", arguments: { limit: 1 } })
    ).structuredContent as unknown as MemoryExportPage;
    const last = (
      await writer.callTool({
        name: "ezer_export",
        arguments: { cursor: first.nextCursor!, limit: 1 },
      })
    ).structuredContent as unknown as MemoryExportPage;
    target = await createAcceptanceFixture({ allowRestore: true });
    const leaf = (path: string) =>
      new X509Certificate(
        readFileSync(path, "utf8")
          .match(
            /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g,
          )!
          .at(-1)!,
      );
    assert.notEqual(leaf(source.caFile).subject, leaf(target.caFile).subject);
    // Distinct subjects keep both self-signed leaves usable in the shared trust list.
    const freshSource = await source.client("alpha");
    assert.ok(
      !(await freshSource.callTool({ name: "ezer_identity", arguments: {} }))
        .isError,
    );
    await freshSource.close();
    let restorer = await target.client("alpha");
    const command = {
      name: "ezer_restore",
      arguments: { restoreId: "complete-recovery", page: first },
    };
    assert.ok(!(await restorer.callTool(command)).isError);
    assert.ok(
      (
        await restorer.callTool({
          name: "ezer_read",
          arguments: { memoryId: content.memoryId },
        })
      ).isError,
    );
    await restorer.close();
    await target.restart();
    restorer = await target.client("alpha");
    assert.ok(!(await restorer.callTool(command)).isError);
    assert.ok(
      !(
        await restorer.callTool({
          name: "ezer_restore",
          arguments: { restoreId: "complete-recovery", page: last },
        })
      ).isError,
    );
    for (const expected of [first, last]) {
      const cursor = expected === first ? undefined : first.nextCursor!;
      const actual = await restorer.callTool({
        name: "ezer_export",
        arguments: { limit: 1, ...(cursor ? { cursor } : {}) },
      });
      assert.ok(!actual.isError);
      assert.deepEqual(actual.structuredContent, expected);
    }
    const isolated = await target.client("beta");
    const denied = await isolated.callTool(command);
    assert.deepEqual(denied.content, [
      { type: "text", text: "IDENTITY_MISMATCH" },
    ]);
    assert.ok(
      !(await writer.callTool({ name: "ezer_export", arguments: {} })).isError,
    );
  },
);

test(
  "packaged HTTPS connections preserve memories across sessions and runtime restarts",
  { timeout: 60000 },
  async (t) => {
    const fixture = await createAcceptanceFixture();
    t.after(() => fixture.close());
    const certificates = readFileSync(fixture.caFile, "utf8").match(
      /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g,
    );
    assert.ok(certificates?.length);
    const endpointCertificate = new X509Certificate(certificates.at(-1)!);
    assert.equal(
      endpointCertificate.ca,
      false,
      "The HTTPS endpoint needs a leaf certificate",
    );
    assert.equal(endpointCertificate.checkIP("127.0.0.1"), "127.0.0.1");
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
    const exported = await third.callTool({
      name: "ezer_export",
      arguments: { limit: 1 },
    });
    assert.ok(!exported.isError);
    const exportPage =
      exported.structuredContent as unknown as MemoryExportPage;
    assert.deepEqual(exportPage, {
      format: "ezer-memory",
      formatVersion: 1,
      individualId: "acceptance-alpha",
      snapshotSequence: 2,
      revisions: [
        (history.structuredContent as unknown as MemoryInspection).memory,
      ],
      nextCursor: { snapshotSequence: 2, afterSequence: 1 },
    });
    const text = exported.content[0];
    assert.ok(text?.type === "text");
    assert.deepEqual(JSON.parse(text.text), exportPage);
    await third.close();
    await fixture.restart();
    const resumed = await fixture.client("alpha");
    const remainder = await resumed.callTool({
      name: "ezer_export",
      arguments: { cursor: exportPage.nextCursor! },
    });
    assert.ok(!remainder.isError);
    assert.deepEqual(remainder.structuredContent, {
      ...exportPage,
      revisions: [
        (corrected.structuredContent as unknown as MemoryInspection).memory,
      ],
      nextCursor: null,
    });
    const other = await fixture.client("beta");
    const otherExport = await other.callTool({
      name: "ezer_export",
      arguments: {},
    });
    assert.ok(!otherExport.isError);
    assert.deepEqual(otherExport.structuredContent, {
      format: "ezer-memory",
      formatVersion: 1,
      individualId: "acceptance-beta",
      snapshotSequence: 0,
      revisions: [],
      nextCursor: null,
    });
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
    const exportDenial = await denied.callTool({
      name: "ezer_export",
      arguments: {},
    });
    assert.equal(exportDenial.isError, true);
    assert.deepEqual(exportDenial.content, [
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
