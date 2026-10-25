import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalFixture } from "../tests/local/index.ts";
import { runHostSession } from "../tests/acceptance/index.ts";

const fixture = createLocalFixture();
const suffix = randomUUID().slice(0, 8);
const name = `ezer-local-proof-${suffix}`;
const marketplace = join(fixture.root, "marketplace");
const instance = {
  name,
  marketplace,
  plugin: join(marketplace, "plugins", name),
};
const marker = `SYNTHETIC-${randomUUID()}`;
const command = (args: string[]) =>
  spawnSync("codex", args, {
    encoding: "utf8",
    timeout: 60000,
    maxBuffer: 1_000_000,
  });
const evidence: { scenario: string; status: string; tools: string[] }[] = [];
let installed = false;
let registered = false;
let failed = false;
let stage = "inventory";
try {
  const before = command(["plugin", "marketplace", "list", "--json"]);
  assert.equal(before.status, 0);
  assert.ok(!before.stdout.includes(name));
  stage = "package";
  const packaged = spawnSync(
    process.execPath,
    [
      fileURLToPath(
        new URL("../../../scripts/package-plugin.ts", import.meta.url),
      ),
      "--name",
      name,
      "--local",
      "--individual",
      "alpha",
      "--data-dir",
      join(fixture.root, "data"),
      "--out",
      marketplace,
    ],
    { encoding: "utf8", timeout: 30000, maxBuffer: 1_000_000 },
  );
  assert.equal(packaged.status, 0);
  stage = "register-marketplace";
  registered = true;
  assert.equal(
    command(["plugin", "marketplace", "add", marketplace, "--json"]).status,
    0,
  );
  stage = "install-plugin";
  installed = true;
  assert.equal(
    command(["plugin", "add", `${name}@${name}-local`, "--json"]).status,
    0,
  );
  stage = "verify-installation";
  const installedList = command([
    "plugin",
    "list",
    "--marketplace",
    `${name}-local`,
    "--json",
  ]);
  assert.equal(installedList.status, 0);
  assert.ok(
    JSON.parse(installedList.stdout).installed.some(
      (entry: { name: string; enabled: boolean }) =>
        entry.name === name && entry.enabled,
    ),
  );
  stage = "observer";
  const observer = await fixture.connect();
  const call = async (tool: string, args: Record<string, unknown> = {}) => {
    const result = await observer.client.callTool({
      name: tool,
      arguments: args,
    });
    assert.notEqual(result.isError, true);
    return result.structuredContent as Record<string, unknown>;
  };
  const session = async (
    scenario: string,
    prompt: string,
    required: string[],
  ) => {
    stage = scenario;
    const result = await runHostSession({
      host: "codex",
      instances: [instance],
      active: instance,
      workspace: fixture.directory(scenario),
      prompt: `${prompt}\nAll information is synthetic. Use only this Ezer's plugin and MCP. Do not inspect databases, change settings, use shell commands, read unrelated host files, contact others, or select another Ezer.`,
    });
    const passed =
      !result.reason &&
      required.every((tool) =>
        result.usedTools.some((used) => used.endsWith(tool)),
      );
    evidence.push({
      scenario,
      status: passed ? "passed" : (result.reason ?? "missing-tool-evidence"),
      tools: result.usedTools,
    });
    assert.ok(passed);
    console.log(JSON.stringify(evidence.at(-1)));
    return result;
  };
  await session(
    "create",
    `Remember that my synthetic preferred drink is ${marker}, with this conversation as source. Also create a workspace note at notes/preference.md with fileId preference, operationId create-preference, expectedVersion 0, and exact content ${marker}.`,
    ["ezer_identity", "ezer_remember", "ezer_file_write"],
  );
  assert.equal(
    (await call("ezer_file_read", { fileId: "preference" })).content,
    marker,
  );
  const memory = await call("ezer_list");
  assert.ok(JSON.stringify(memory).includes(marker));
  const initialIdentity = await call("ezer_identity");
  const recalled = await session(
    "fresh-session",
    "Recover my preferred drink from your memory and read the preference note in your workspace. Report the saved drink exactly. This is read-only: do not create or modify anything.",
    ["ezer_identity", "ezer_read", "ezer_file_read"],
  );
  assert.ok(recalled.answer.includes(marker));
  assert.deepEqual(await call("ezer_identity"), initialIdentity);
  await session(
    "recover-file",
    "For workspace fileId preference, replace its content with SYNTHETIC-UPDATED, then put it in the trash, then restore its original version 1. Check the current version before each change. Use a different stable operationId for each step. Do not create or change memories.",
    ["ezer_file_write", "ezer_file_trash", "ezer_file_restore"],
  );
  assert.equal(
    (await call("ezer_file_read", { fileId: "preference" })).content,
    marker,
  );
  const history = await call("ezer_file_history", { fileId: "preference" });
  assert.equal((history.files as unknown[]).length, 4);
  assert.deepEqual(await call("ezer_identity"), initialIdentity);
} catch {
  failed = true;
  console.log(
    JSON.stringify({
      scenario: "local-native-acceptance",
      status: "failed",
      reason: "setup-or-behavior-check-failed",
      stage,
    }),
  );
} finally {
  if (installed) {
    const removed = command([
      "plugin",
      "remove",
      `${name}@${name}-local`,
      "--json",
    ]);
    const listing = command([
      "plugin",
      "list",
      "--marketplace",
      `${name}-local`,
      "--json",
    ]);
    let verified = false;
    try {
      verified =
        listing.status === 0 &&
        !JSON.parse(listing.stdout).installed.some(
          (entry: { name: string }) => entry.name === name,
        );
    } catch {
      /* Unconfirmed cleanup is a failure. */
    }
    if (removed.status !== 0 || !verified) {
      failed = true;
      console.log(
        JSON.stringify({ status: "plugin-cleanup-unconfirmed", plugin: name }),
      );
    }
  }
  if (registered) {
    const removed = command([
      "plugin",
      "marketplace",
      "remove",
      `${name}-local`,
      "--json",
    ]);
    const listing = command(["plugin", "marketplace", "list", "--json"]);
    if (
      removed.status !== 0 ||
      listing.status !== 0 ||
      listing.stdout.includes(name)
    ) {
      failed = true;
      console.log(
        JSON.stringify({
          status: "marketplace-cleanup-unconfirmed",
          marketplace: `${name}-local`,
        }),
      );
    }
  }
  await fixture.close();
}
console.log(
  JSON.stringify({
    host: "codex",
    status: failed ? "failed" : "passed",
    scenarios: evidence,
    skipped: ["Claude Code", "Cloudflare deployment"],
  }),
);
if (failed) process.exitCode = 1;
