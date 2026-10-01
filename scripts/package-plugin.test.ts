import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./package-plugin.ts", import.meta.url));
function fixture(t: TestContext) {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), "ezer-package-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function run(
  out: string,
  name = "ezer-alpha",
  url = "https://alpha.example.com/mcp",
) {
  return spawnSync(
    process.execPath,
    [script, "--name", name, "--url", url, "--out", out],
    { encoding: "utf8" },
  );
}
function json(path: string) {
  return JSON.parse(readFileSync(path, "utf8"));
}

test("packages isolated portable and native connections from an explicit source allowlist", (t) => {
  const root = fixture(t);
  for (const label of ["alpha", "beta"]) {
    const name = `ezer-${label}`;
    const output = join(root, label);
    const url = `https://${label}.example.com/mcp`;
    const result = run(output, name, url);
    assert.equal(result.status, 0, result.stderr);
    const plugin = join(output, "plugins", name);
    const portable = json(join(plugin, "plugin.json"));
    for (const host of ["codex", "claude"]) {
      const native = json(join(plugin, `.${host}-plugin/plugin.json`));
      for (const key of [
        "name",
        "version",
        "description",
        "author",
        "repository",
      ])
        assert.deepEqual(native[key], portable[key]);
      assert.equal(native.mcpServers, "./.mcp.json");
    }
    assert.deepEqual(json(join(plugin, "mcp.json")).mcpServers, {
      [name]: { type: "streamable-http", url },
    });
    assert.deepEqual(json(join(plugin, ".mcp.json")).mcpServers, {
      [name]: { type: "http", url },
    });
    const codex = json(join(output, ".agents/plugins/marketplace.json"));
    const claude = json(join(output, ".claude-plugin/marketplace.json"));
    assert.equal(codex.name, claude.name);
    assert.equal(codex.plugins[0].source.path, `./plugins/${name}`);
    assert.equal(claude.plugins[0].source, `./plugins/${name}`);
    const skill = readFileSync(join(plugin, `skills/${name}/SKILL.md`), "utf8");
    assert.ok(skill.startsWith(`---\nname: ${name}\n`));
    for (const [, path] of skill.matchAll(/\]\((references\/[^)]+)\)/g))
      assert.ok(
        readFileSync(join(plugin, `skills/${name}`, path), "utf8").length > 0,
      );
    const connection = readFileSync(
      join(plugin, `skills/${name}/references/connection.md`),
      "utf8",
    );
    assert.ok(connection.includes(url));
    assert.ok(connection.includes(name));
    assert.deepEqual(
      readdirSync(output, { recursive: true, encoding: "utf8" })
        .filter(
          (path) =>
            !readdirSync(output, { recursive: true, encoding: "utf8" }).some(
              (other) => other.startsWith(path + "/"),
            ),
        )
        .sort(),
      [
        ".agents/plugins/marketplace.json",
        ".claude-plugin/marketplace.json",
        "README.md",
        `plugins/${name}/.claude-plugin/plugin.json`,
        `plugins/${name}/.codex-plugin/plugin.json`,
        `plugins/${name}/.mcp.json`,
        `plugins/${name}/mcp.json`,
        `plugins/${name}/plugin.json`,
        `plugins/${name}/skills/${name}/SKILL.md`,
        `plugins/${name}/skills/${name}/references/connection.md`,
        `plugins/${name}/skills/${name}/references/writing-memories.md`,
      ].sort(),
    );
  }
});

test("rejects unsafe or noncanonical input without echoing it or creating output", (t) => {
  const root = fixture(t);
  for (const url of [
    "http://alpha.example.com/mcp",
    "https://alpha.example.com/",
    "https://user:synthetic-secret@alpha.example.com/mcp",
    "https://alpha.example.com/mcp?token=synthetic-secret",
    "https://alpha.example.com/mcp#synthetic-secret",
    " https://alpha.example.com/mcp",
    "https://alpha.example.com:443/mcp",
  ]) {
    const result = run(join(root, "output"), "ezer-alpha", url);
    assert.equal(result.status, 1);
    assert.ok(!result.stderr.includes(url));
    assert.ok(!result.stderr.includes("synthetic-secret"));
    assert.deepEqual(readdirSync(root), []);
  }
  assert.equal(run(join(root, "output"), "../escape").status, 1);
  assert.deepEqual(readdirSync(root), []);
});

test("preserves existing output and refuses symlink traversal", (t) => {
  const root = fixture(t);
  const marker = join(root, "marker");
  writeFileSync(marker, "keep");
  assert.equal(run(root).status, 1);
  assert.equal(readFileSync(marker, "utf8"), "keep");
  const link = join(root, "link");
  symlinkSync(root, link, "dir");
  assert.equal(run(join(link, "new")).status, 1);
  assert.equal(run(link).status, 1);
  assert.deepEqual(readdirSync(root).sort(), ["link", "marker"]);
});
