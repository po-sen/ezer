import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  linkSync,
  symlinkSync,
  chmodSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import type { Client } from "@modelcontextprotocol/client";
import { createLocalFixture } from "./local/index.ts";

async function value(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
) {
  const result = await client.callTool({ name, arguments: args });
  assert.notEqual(result.isError, true, JSON.stringify(result.content));
  return result.structuredContent as Record<string, any>;
}
async function denied(
  client: Client,
  name: string,
  args: Record<string, unknown>,
  code?: string,
) {
  const result = await client.callTool({ name, arguments: args });
  assert.equal(result.isError, true);
  if (code) assert.ok(JSON.stringify(result.content).includes(code));
}
const note = {
  fileId: "note",
  operationId: "create",
  expectedVersion: 0,
  path: "notes/plan.md",
  content: "Original synthetic note",
};

test(
  "local MCP preserves memories, notes, binary attachments and history across restart and separates individuals",
  { timeout: 30000 },
  async (t) => {
    const fixture = createLocalFixture();
    t.after(() => fixture.close());
    const first = await fixture.connect();
    const tools = (await first.client.listTools()).tools.map(
      (tool) => tool.name,
    );
    for (const name of [
      "ezer_remember",
      "ezer_search",
      "ezer_restore_status",
      "ezer_file_write",
      "ezer_file_read",
      "ezer_file_list",
      "ezer_file_history",
      "ezer_file_move",
      "ezer_file_trash",
      "ezer_file_restore",
    ])
      assert.ok(tools.includes(name));
    await value(first.client, "ezer_remember", {
      operationId: "remember",
      memoryId: "memory",
      body: "Synthetic local continuity",
      source: { reference: "test:local", excerpt: "Synthetic evidence" },
    });
    const receipt = await value(first.client, "ezer_file_write", note);
    assert.equal(receipt.version, 1);
    const changed = await value(first.client, "ezer_file_write", {
      ...note,
      operationId: "edit",
      expectedVersion: 1,
      content: "Changed note",
    });
    assert.equal(changed.version, 2);
    const binary = Buffer.from([0, 255, 128, 10, 13, 42]);
    await value(first.client, "ezer_file_write", {
      ...note,
      operationId: "binary",
      fileId: "attachment",
      path: "attachments/sample.bin",
      content: binary.toString("base64"),
      encoding: "base64",
      mediaType: "application/octet-stream",
    });
    assert.equal(
      (
        await value(first.client, "ezer_file_read", {
          fileId: "attachment",
          encoding: "base64",
        })
      ).content,
      binary.toString("base64"),
    );
    await first.client.close();
    const second = await fixture.connect("alpha", {
      cwd: fixture.directory("another-project"),
    });
    assert.equal(
      (await value(second.client, "ezer_identity")).changeSequence,
      1,
    );
    assert.equal(
      (await value(second.client, "ezer_search", { query: "continuity" }))
        .memories.length,
      1,
    );
    assert.equal(
      (await value(second.client, "ezer_file_read", { fileId: "note" }))
        .content,
      "Changed note",
    );
    assert.equal(
      (
        await value(second.client, "ezer_file_read", {
          fileId: "note",
          version: 1,
        })
      ).content,
      note.content,
    );
    assert.deepEqual(
      await value(second.client, "ezer_file_write", note),
      receipt,
    );
    const history = await value(second.client, "ezer_file_history", {
      fileId: "note",
      limit: 1,
    });
    assert.equal(history.files[0].version, 2);
    assert.equal(
      (
        await value(second.client, "ezer_file_history", {
          fileId: "note",
          beforeVersion: history.nextBeforeVersion,
        })
      ).files[0].version,
      1,
    );
    const other = await fixture.connect("beta");
    assert.equal((await value(other.client, "ezer_list")).memories.length, 0);
    assert.equal((await value(other.client, "ezer_file_list")).files.length, 0);
    await denied(
      other.client,
      "ezer_file_read",
      { fileId: "note" },
      "NOT_FOUND",
    );
    await denied(other.client, "ezer_file_read", {
      fileId: "note",
      individualId: "alpha",
    });
    await denied(
      second.client,
      "ezer_restore_status",
      {},
      "RESTORE_NOT_GRANTED",
    );
  },
);

test(
  "trash, moves and restoration are versioned, preserve bytes, and reject occupied destinations",
  { timeout: 30000 },
  async (t) => {
    const fixture = createLocalFixture();
    t.after(() => fixture.close());
    const { client } = await fixture.connect();
    await value(client, "ezer_file_write", note);
    await value(client, "ezer_file_move", {
      fileId: "note",
      operationId: "move",
      expectedVersion: 1,
      path: "outputs/result.md",
    });
    await value(client, "ezer_file_trash", {
      fileId: "note",
      operationId: "trash",
      expectedVersion: 2,
    });
    assert.equal((await value(client, "ezer_file_list")).files.length, 0);
    const trash = await value(client, "ezer_file_list", { deleted: true });
    assert.equal(trash.files[0].version, 3);
    await denied(client, "ezer_file_read", { fileId: "note" }, "NOT_FOUND");
    await value(client, "ezer_file_write", {
      ...note,
      operationId: "occupy",
      fileId: "other",
    });
    await denied(
      client,
      "ezer_file_restore",
      {
        fileId: "note",
        operationId: "restore",
        expectedVersion: 3,
        version: 1,
      },
      "PATH_OCCUPIED",
    );
    const restored = await value(client, "ezer_file_restore", {
      fileId: "note",
      operationId: "restore",
      expectedVersion: 3,
      version: 1,
      path: "recovered/plan.md",
    });
    assert.equal(restored.version, 4);
    assert.equal(
      (await value(client, "ezer_file_read", { fileId: "note" })).content,
      note.content,
    );
    assert.equal(
      (await value(client, "ezer_file_history", { fileId: "note" })).files
        .length,
      4,
    );
    assert.equal(
      (await value(client, "ezer_file_list", { deleted: true })).files.length,
      0,
    );
  },
);

test(
  "two independent processes share one individual with conflict checks, exact retries, and snapshot listing",
  { timeout: 30000 },
  async (t) => {
    const fixture = createLocalFixture();
    t.after(() => fixture.close());
    const [first, second] = await Promise.all([
      fixture.connect(),
      fixture.connect(),
    ]);
    await value(first.client, "ezer_file_write", note);
    const writes = await Promise.all(
      [first, second].map((session, index) =>
        session.client.callTool({
          name: "ezer_file_write",
          arguments: {
            ...note,
            operationId: `concurrent-${index}`,
            expectedVersion: 1,
            content: `Writer ${index}`,
          },
        }),
      ),
    );
    assert.equal(writes.filter((result) => !result.isError).length, 1);
    assert.ok(
      JSON.stringify(writes.find((result) => result.isError)?.content).includes(
        "VERSION_CONFLICT",
      ),
    );
    await denied(
      first.client,
      "ezer_file_write",
      { ...note, content: "Different retry" },
      "OPERATION_CONFLICT",
    );
    await value(first.client, "ezer_file_write", {
      ...note,
      fileId: "two",
      operationId: "two",
      path: "two.md",
    });
    const page = await value(first.client, "ezer_file_list", { limit: 1 });
    await value(second.client, "ezer_file_trash", {
      fileId: "two",
      operationId: "trash-two",
      expectedVersion: 1,
    });
    const next = await value(first.client, "ezer_file_list", {
      limit: 1,
      cursor: page.nextCursor,
    });
    assert.equal(next.files[0].fileId, "two");
    assert.equal(next.files[0].deleted, false);
    assert.equal(next.nextCursor, null);
    await denied(
      first.client,
      "ezer_file_list",
      { deleted: true, cursor: page.nextCursor },
      "INVALID_INPUT",
    );
    const committed = await value(first.client, "ezer_file_read", {
      fileId: "note",
    });
    process.kill(first.transport.pid!, "SIGKILL");
    await first.client.close();
    const restarted = await fixture.connect();
    assert.equal(
      (await value(restarted.client, "ezer_file_read", { fileId: "note" }))
        .content,
      committed.content,
    );
  },
);

test(
  "file boundaries reject traversal, bad bytes, excessive sizes and file/directory collisions",
  { timeout: 30000 },
  async (t) => {
    const fixture = createLocalFixture();
    t.after(() => fixture.close());
    const { client } = await fixture.connect();
    for (const path of [
      "../outside",
      "/absolute",
      "a/../escape",
      "a//b",
      "a\\b",
      "C:/escape",
      "a/CON",
      "a/.",
      "a/..",
      "a/trailing.",
      "a/\u0000bad",
      "a/\ud800bad",
    ]) {
      await denied(
        client,
        "ezer_file_write",
        { ...note, path },
        "INVALID_INPUT",
      );
    }
    await denied(
      client,
      "ezer_file_write",
      { ...note, encoding: "base64", content: "%%%" },
      "INVALID_INPUT",
    );
    await denied(
      client,
      "ezer_file_write",
      { ...note, content: "\ud800" },
      "INVALID_INPUT",
    );
    await denied(
      client,
      "ezer_file_write",
      { ...note, content: "x".repeat(1_048_577) },
      "INVALID_INPUT",
    );
    await value(client, "ezer_file_write", note);
    await denied(
      client,
      "ezer_file_write",
      { ...note, fileId: "collision", operationId: "collision", path: "notes" },
      "PATH_OCCUPIED",
    );
    const large = Buffer.alloc(70_000, 255);
    await value(client, "ezer_file_write", {
      ...note,
      fileId: "binary",
      operationId: "binary",
      path: "blob.bin",
      content: large.toString("base64"),
      encoding: "base64",
      mediaType: "application/octet-stream",
    });
    await denied(
      client,
      "ezer_file_read",
      { fileId: "binary" },
      "INVALID_INPUT",
    );
    const first = await value(client, "ezer_file_read", {
      fileId: "binary",
      encoding: "base64",
    });
    const second = await value(client, "ezer_file_read", {
      fileId: "binary",
      version: first.file.version,
      offset: first.nextOffset,
      encoding: "base64",
    });
    assert.deepEqual(
      Buffer.concat([
        Buffer.from(first.content, "base64"),
        Buffer.from(second.content, "base64"),
      ]),
      large,
    );
    assert.equal(second.nextOffset, null);
    const unicode = "\ufeffSynthetic café";
    await value(client, "ezer_file_write", {
      ...note,
      fileId: "unicode",
      operationId: "unicode",
      path: "notes/🦦.txt",
      content: unicode,
    });
    assert.equal(
      (await value(client, "ezer_file_read", { fileId: "unicode" })).content,
      unicode,
    );
  },
);

test(
  "local memory restores complete history after interruption while Workspace remains independent",
  { timeout: 30000 },
  async (t) => {
    const fixture = createLocalFixture();
    t.after(() => fixture.close());
    const source = await fixture.connect();
    const memory = {
      memoryId: "memory",
      source: {
        reference: "test:local-restore",
        excerpt: "Synthetic evidence",
      },
    };
    await value(source.client, "ezer_remember", {
      ...memory,
      operationId: "one",
      body: "Original",
    });
    await value(source.client, "ezer_revise", {
      ...memory,
      operationId: "two",
      expectedRevision: 1,
      reason: "New evidence",
      body: "Corrected",
    });
    const first = await value(source.client, "ezer_export", { limit: 1 });
    const last = await value(source.client, "ezer_export", {
      limit: 1,
      cursor: first.nextCursor,
    });
    const targetRoot = fixture.directory("restore-target");
    let target = await fixture.connect("alpha", {
      allowRestore: true,
      dataDirectory: targetRoot,
    });
    await value(target.client, "ezer_file_write", note);
    assert.deepEqual(await value(target.client, "ezer_restore_status"), {
      restore: null,
    });
    const command = { restoreId: "recovery", page: first };
    await value(target.client, "ezer_restore", command);
    assert.equal(
      (await value(target.client, "ezer_identity")).changeSequence,
      0,
    );
    await denied(
      target.client,
      "ezer_read",
      { memoryId: "memory" },
      "RESTORE_IN_PROGRESS",
    );
    assert.equal(
      (await value(target.client, "ezer_file_read", { fileId: "note" }))
        .content,
      note.content,
    );
    await target.client.close();
    target = await fixture.connect("alpha", {
      allowRestore: true,
      dataDirectory: targetRoot,
    });
    assert.deepEqual(await value(target.client, "ezer_restore_status"), {
      restore: {
        restoreId: "recovery",
        snapshotSequence: 2,
        restoredSequence: 1,
        complete: false,
      },
    });
    await value(target.client, "ezer_restore", command);
    await value(target.client, "ezer_restore", {
      restoreId: "recovery",
      page: last,
    });
    assert.deepEqual(
      await value(target.client, "ezer_export", { limit: 1 }),
      first,
    );
    assert.deepEqual(
      await value(target.client, "ezer_export", {
        limit: 1,
        cursor: first.nextCursor,
      }),
      last,
    );
    assert.equal(
      (await value(target.client, "ezer_file_read", { fileId: "note" }))
        .content,
      note.content,
    );
    const other = await fixture.connect("beta", {
      allowRestore: true,
      dataDirectory: targetRoot,
    });
    await denied(other.client, "ezer_restore", command, "IDENTITY_MISMATCH");
  },
);

test(
  "local startup rejects symlinks, hardlinks, identity substitution and unsafe permissions without resetting data",
  { timeout: 30000 },
  async (t) => {
    const fixture = createLocalFixture();
    t.after(() => fixture.close());
    const first = await fixture.connect();
    await value(first.client, "ezer_file_write", note);
    await first.client.close();
    const entry = fileURLToPath(
      new URL("../dist/local/entrypoints/local.mjs", import.meta.url),
    );
    const run = (data: string, individual = "alpha") =>
      spawnSync(
        process.execPath,
        [entry, "--data-dir", data, "--individual", individual],
        { encoding: "utf8", timeout: 10000 },
      );
    symlinkSync(join(fixture.root, "data"), join(fixture.root, "linked"));
    assert.equal(run(join(fixture.root, "linked")).status, 1);
    const other = fixture.directory("other");
    const beta = join(other, "beta");
    const betaFixture = await fixture.connect("beta", { dataDirectory: other });
    await betaFixture.client.close();
    copyFileSync(
      join(fixture.root, "data/alpha/memory.sqlite"),
      join(beta, "memory.sqlite"),
    );
    assert.equal(run(other, "beta").status, 1);
    const hard = fixture.directory("hard");
    const destination = join(hard, "alpha");
    const hardFixture = await fixture.connect("alpha", { dataDirectory: hard });
    await hardFixture.client.close();
    const marker = join(destination, "memory.sqlite-journal");
    linkSync(join(fixture.root, "data/alpha/memory.sqlite"), marker);
    assert.equal(run(hard).status, 1);
    if (process.platform !== "win32") {
      chmodSync(join(fixture.root, "data"), 0o755);
      assert.equal(run(join(fixture.root, "data")).status, 1);
      chmodSync(join(fixture.root, "data"), 0o700);
    }
    assert.equal(existsSync(join(fixture.root, "outside")), false);
    assert.ok(
      readFileSync(join(fixture.root, "data/alpha/workspace.sqlite")).length >
        0,
    );
  },
);
