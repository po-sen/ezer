import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, renameSync, readdirSync } from "node:fs";
import { createLocalFixture } from "./local/index.ts";

test(
  "a relocated plugin package starts its self-contained local MCP and preserves data through package replacement",
  { timeout: 60000 },
  async (t) => {
    const fixture = createLocalFixture();
    t.after(() => fixture.close());
    const packager = fileURLToPath(
      new URL("../../../scripts/package-plugin.ts", import.meta.url),
    );
    const output = join(fixture.root, "package");
    const args = [
      packager,
      "--name",
      "ezer-package-test",
      "--local",
      "--individual",
      "alpha",
      "--data-dir",
      join(fixture.root, "data"),
      "--out",
      output,
    ];
    const packaged = spawnSync(process.execPath, args, {
      encoding: "utf8",
      timeout: 30000,
    });
    assert.equal(packaged.status, 0, packaged.stderr);
    const relocated = join(fixture.root, "relocated package");
    renameSync(output, relocated);
    const plugin = join(relocated, "plugins/ezer-package-test");
    const json = (file: string) =>
      JSON.parse(readFileSync(join(plugin, file), "utf8"));
    const portable = json("mcp.json").mcpServers["ezer-package-test"];
    assert.equal(portable.type, "stdio");
    assert.equal(portable.command, "node");
    assert.equal(
      portable.args[0],
      "${PLUGIN_ROOT}/server/entrypoints/local.mjs",
    );
    assert.equal(
      json(".mcp.json").mcpServers["ezer-package-test"].args[0],
      "${CLAUDE_PLUGIN_ROOT}/server/entrypoints/local.mjs",
    );
    assert.deepEqual(
      json(".codex-mcp.json").mcpServers["ezer-package-test"],
      portable,
    );
    assert.equal(
      json("plugin.json").extensions["com.openai"].requires_local_executor,
      true,
    );
    assert.ok(
      !readdirSync(plugin, { recursive: true, encoding: "utf8" }).some((file) =>
        /(?:node_modules|\.sqlite|\.py$|\.env)/.test(file),
      ),
    );
    const first = await fixture.connect("alpha", {
      entrypoint: join(plugin, "server/entrypoints/local.mjs"),
    });
    const written = await first.client.callTool({
      name: "ezer_file_write",
      arguments: {
        fileId: "note",
        operationId: "create",
        expectedVersion: 0,
        path: "notes.md",
        content: "Synthetic persistent output",
      },
    });
    assert.notEqual(written.isError, true);
    await first.client.close();
    // A fresh version/cached copy can bind the existing data independently of its install path.
    const second = spawnSync(process.execPath, args, {
      encoding: "utf8",
      timeout: 30000,
    });
    assert.equal(second.status, 0, second.stderr);
    const updated = await fixture.connect("alpha", {
      entrypoint: join(
        output,
        "plugins/ezer-package-test/server/entrypoints/local.mjs",
      ),
    });
    const read = await updated.client.callTool({
      name: "ezer_file_read",
      arguments: { fileId: "note" },
    });
    assert.equal(
      (read.structuredContent as { content: string }).content,
      "Synthetic persistent output",
    );
  },
);

test(
  "local packaging rejects ambiguous transport, unsafe identity and relative data roots",
  { timeout: 30000 },
  async (t) => {
    const fixture = createLocalFixture();
    t.after(() => fixture.close());
    const script = fileURLToPath(
      new URL("../../../scripts/package-plugin.ts", import.meta.url),
    );
    for (const options of [
      ["--local", "--individual", "alpha", "--url", "https://example.com/mcp"],
      ["--local", "--individual", "../other"],
      ["--local", "--individual", "alpha", "--data-dir", "relative"],
      [
        "--local",
        "--individual",
        "alpha",
        "--data-dir",
        join(fixture.root, "package/data"),
      ],
      ["--local"],
      ["--url", "https://example.com/mcp", "--individual", "alpha"],
    ]) {
      const result = spawnSync(
        process.execPath,
        [
          script,
          "--name",
          "ezer-test",
          ...options,
          "--out",
          join(fixture.root, "package"),
        ],
        { encoding: "utf8", timeout: 10000 },
      );
      assert.equal(result.status, 1);
    }
    assert.deepEqual(readdirSync(fixture.root), []);
  },
);
