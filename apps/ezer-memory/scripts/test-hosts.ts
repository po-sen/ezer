import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import type {
  MemoryInspection,
  MemoryPage,
} from "../src/modules/memory/ports/inbound/index.ts";
import {
  createAcceptanceFixture,
  runHostSession,
} from "../tests/acceptance/index.ts";

const { values } = parseArgs({ options: { host: { type: "string" } } });
if (values.host !== undefined && !["codex", "claude"].includes(values.host))
  throw new Error("Use --host codex or --host claude");
const hosts = values.host
  ? [values.host as "codex" | "claude"]
  : (["codex", "claude"] as const);
let failed = false;
for (const host of hosts) {
  const fixture = await createAcceptanceFixture();
  const alpha = fixture.instance("alpha");
  const beta = fixture.instance("beta");
  const command = (args: string[]) =>
    spawnSync(host, args, {
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 1_000_000,
    });
  const version = command(["--version"]).stdout?.trim();
  const marker = `SYNTHETIC-${randomUUID()}`;
  const corrected = `UPDATED-${randomUUID()}`;
  const installed: (typeof alpha)[] = [];
  const registered: (typeof alpha)[] = [];
  const evidence: {
    scenario: string;
    status: string;
    tools: string[];
    reason?: string;
  }[] = [];
  let memoryId: string;
  try {
    if (host === "codex") {
      for (const instance of [alpha, beta]) {
        registered.push(instance);
        assert.equal(
          command([
            "plugin",
            "marketplace",
            "add",
            instance.marketplace,
            "--json",
          ]).status,
          0,
        );
        installed.push(instance);
        assert.equal(
          command([
            "plugin",
            "add",
            `${instance.name}@${instance.name}-local`,
            "--json",
          ]).status,
          0,
        );
        const listing = command([
          "plugin",
          "list",
          "--marketplace",
          `${instance.name}-local`,
          "--json",
        ]);
        assert.equal(listing.status, 0);
        assert.ok(
          JSON.parse(listing.stdout).installed.some(
            (entry: { name: string; enabled: boolean }) =>
              entry.name === instance.name && entry.enabled,
          ),
        );
      }
    }
    async function stored(revision: number, value: string, historical = false) {
      const observer = await fixture.client("alpha");
      try {
        const response = await observer.callTool({
          name: "ezer_read",
          arguments: { memoryId, ...(historical ? { revision } : {}) },
        });
        assert.ok(!response.isError);
        const inspection =
          response.structuredContent as unknown as MemoryInspection;
        assert.equal(inspection.individualId, "acceptance-alpha");
        assert.equal(inspection.memory.revision, revision);
        assert.ok(inspection.memory.body.includes(value));
        assert.ok(inspection.memory.source.excerpt.includes(value));
        assert.ok(inspection.memory.source.reference.length > 0);
        if (revision > 1) assert.ok(inspection.memory.reason);
      } finally {
        await observer.close();
      }
    }
    async function session(
      scenario: string,
      active: typeof alpha,
      prompt: string,
      expected: string,
      required: string[],
      verify: (calls: typeof fixture.calls) => Promise<void>,
      writes = false,
    ) {
      const offset = fixture.calls.length;
      const result = await runHostSession({
        host,
        instances: [alpha, beta],
        active,
        workspace: fixture.workspace(host),
        caFile: fixture.caFile,
        prompt: `${prompt}\nUse only this Ezer's memory and packaged skill references. Do not read other files, contact other services, or use another Ezer. All facts in this test are synthetic. Do not save a memory for a recall-only request.`,
      });
      const calls = fixture.calls.slice(offset);
      const tools = calls.map((call) => call.tool);
      let reason =
        result.reason ??
        (calls.some(
          (call) => call.instance !== (active === alpha ? "alpha" : "beta"),
        )
          ? "wrong-instance"
          : !writes &&
              tools.some((tool) =>
                ["ezer_remember", "ezer_revise"].includes(tool),
              )
            ? "unexpected-write"
            : required.some((tool) => !tools.includes(tool))
              ? "missing-tool-evidence"
              : !result.answer.includes(expected)
                ? "unexpected-answer"
                : null);
      if (!reason) {
        try {
          await verify(calls);
        } catch {
          reason = "stored-memory-mismatch";
        }
      }
      const blocked = [
        "organization-access-denied",
        "host-unavailable",
      ].includes(reason ?? "");
      evidence.push({
        scenario,
        status: reason ? (blocked ? "blocked" : "failed") : "passed",
        tools,
        ...(reason ? { reason } : {}),
      });
      console.log(JSON.stringify({ host, ...evidence[evidence.length - 1] }));
      return !reason;
    }
    const learned = await session(
      "learn",
      alpha,
      `My synthetic favorite drink is ${marker}. Remember this for our next conversation, with this message as the source. Confirm the saved drink.`,
      marker,
      ["ezer_service_info", "ezer_identity", "ezer_remember"],
      async (calls) => {
        const write = calls.find(
          (call) =>
            call.tool === "ezer_remember" &&
            String(call.arguments.body).includes(marker),
        );
        assert.equal(typeof write?.arguments.memoryId, "string");
        memoryId = write!.arguments.memoryId as string;
        await stored(1, marker);
      },
      true,
    );
    if (learned) {
      await fixture.restart();
      await session(
        "fresh-session-recall",
        alpha,
        "What is my favorite drink? Recover it from our memories and answer with the stored drink.",
        marker,
        ["ezer_identity", "ezer_list", "ezer_read"],
        () => stored(1, marker),
      );
      const revised = await session(
        "correction",
        alpha,
        `My favorite drink changed to ${corrected}. Correct the existing preference with this message as the source; preserve its history. Confirm the new drink.`,
        corrected,
        ["ezer_read", "ezer_revise"],
        async () => {
          await stored(2, corrected);
          await stored(1, marker, true);
        },
        true,
      );
      if (revised)
        await session(
          "corrected-recall",
          alpha,
          "What is my current favorite drink? Recover it from our memories.",
          corrected,
          ["ezer_list", "ezer_read"],
          () => stored(2, corrected),
        );
      await session(
        "other-individual",
        beta,
        "What is my favorite drink? Recover only this Ezer's memories. If no stored preference exists, reply NO_STORED_PREFERENCE. Do not create a record.",
        "NO_STORED_PREFERENCE",
        ["ezer_identity", "ezer_list"],
        async () => {
          const observer = await fixture.client("beta");
          try {
            const page = await observer.callTool({
              name: "ezer_list",
              arguments: {},
            });
            assert.ok(!page.isError);
            assert.deepEqual(
              (page.structuredContent as unknown as MemoryPage).memories,
              [],
            );
            const lookup = await observer.callTool({
              name: "ezer_read",
              arguments: { memoryId },
            });
            assert.equal(lookup.isError, true);
          } finally {
            await observer.close();
          }
        },
      );
    }
  } catch {
    evidence.push({
      scenario: "setup-or-runtime",
      status: "failed",
      tools: [],
      reason: "acceptance-setup-or-runtime-failed",
    });
  } finally {
    for (const instance of installed) {
      const cleanup = command([
        "plugin",
        "remove",
        `${instance.name}@${instance.name}-local`,
        "--json",
      ]);
      const listing = command([
        "plugin",
        "list",
        "--marketplace",
        `${instance.name}-local`,
        "--json",
      ]);
      let removed = false;
      try {
        removed =
          listing.status === 0 &&
          !JSON.parse(listing.stdout).installed.some(
            (entry: { name: string }) => entry.name === instance.name,
          );
      } catch {
        /* Invalid output cannot confirm cleanup. */
      }
      if (cleanup.status !== 0 || !removed) {
        failed = true;
        console.log(
          JSON.stringify({
            host,
            status: "cleanup-unconfirmed",
            plugin: instance.name,
          }),
        );
      }
    }
    for (const instance of registered) {
      if (
        command([
          "plugin",
          "marketplace",
          "remove",
          `${instance.name}-local`,
          "--json",
        ]).status !== 0
      ) {
        failed = true;
        console.log(
          JSON.stringify({
            host,
            status: "marketplace-cleanup-unconfirmed",
            marketplace: `${instance.name}-local`,
          }),
        );
      }
    }
    await fixture.close();
  }
  const passed =
    evidence.length === 5 && evidence.every((item) => item.status === "passed");
  failed ||= !passed;
  console.log(
    JSON.stringify({
      host,
      version,
      status: passed
        ? "passed"
        : evidence.some((item) => item.status === "blocked")
          ? "blocked"
          : "failed",
      scenarios: evidence,
      notRun:
        5 -
        evidence.filter((item) => item.scenario !== "setup-or-runtime").length,
    }),
  );
}
if (failed) process.exitCode = 1;
