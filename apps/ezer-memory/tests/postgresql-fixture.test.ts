import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { test, type TestContext } from "node:test";
import pg from "pg";
import { createFixture } from "./postgresql/index.ts";

function harness(t: TestContext, failures: readonly string[] = []) {
  const events: string[] = [];
  const clients = new Map<pg.Client, number>();
  const cleanups: (() => Promise<void>)[] = [];
  const record = (event: string) => {
    events.push(event);
    if (failures.includes(event))
      throw new Error(`Synthetic failure: ${event}`);
  };
  t.mock.method(
    pg.Client.prototype,
    "connect",
    async function (this: pg.Client) {
      clients.set(this, clients.size + 1);
      record(`connect:${clients.get(this)}`);
    },
  );
  t.mock.method(pg.Client.prototype, "query", async (sql: string) => {
    assert.match(
      sql,
      /^(CREATE|DROP) DATABASE ezer_migration_[a-f0-9]{32}( WITH \(FORCE\))?$/,
    );
    record(sql.startsWith("CREATE") ? "create" : "drop");
  });
  t.mock.method(pg.Client.prototype, "end", async function (this: pg.Client) {
    record(`end:${clients.get(this)}`);
  });
  t.mock.method(fs, "mkdtempSync", () => {
    record("mkdir");
    return "/synthetic-fixture";
  });
  t.mock.method(fs, "cpSync", () => record("copy"));
  t.mock.method(fs, "rmSync", () => record("remove"));
  return {
    events,
    cleanups,
    create: () => createFixture((cleanup) => cleanups.push(cleanup)),
  };
}

test("PostgreSQL subprocesses discard inherited settings and remove their temporary home", () => {
  const probe = `
    import assert from "node:assert/strict";
    import { existsSync } from "node:fs";
    import pg from "pg";
    const client = new pg.Client({
      host: "127.0.0.1", port: 55439, user: "ezer_test", database: "ezer_test"
    });
    assert.equal(client.password, null);
    assert.equal(client.ssl, false);
    assert.equal(client.connectionParameters.options, undefined);
    assert.equal(client.connectionParameters.application_name, undefined);
    assert.equal(process.env.NODE_OPTIONS, undefined);
    assert.equal(process.env.EZER_PARENT_SENTINEL, undefined);
    assert.equal(existsSync(process.env.PGPASSFILE), false);
    assert.equal(existsSync(process.env.HOME), true);
    process.stdout.write(process.env.HOME);
  `;
  const wrapper = `
    import assert from "node:assert/strict";
    import { existsSync } from "node:fs";
    import { runIsolatedNode } from ${JSON.stringify(new URL("../scripts/index.ts", import.meta.url).href)};
    for (const code of [${JSON.stringify(probe)}, ${JSON.stringify(probe + "\nprocess.exitCode = 23;")}]) {
      const result = runIsolatedNode(["--input-type=module", "--eval", code]);
      assert.equal(result.status, code.includes("exitCode") ? 23 : 0, result.stderr);
      assert.equal(existsSync(result.stdout), false);
    }
  `;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", wrapper],
    {
      encoding: "utf8",
      cwd: new URL("../", import.meta.url),
      // These are synthetic values, never values copied from the user's environment.
      env: {
        PATH: "/usr/bin:/bin",
        PGHOST: "invalid.example",
        PGPORT: "1",
        PGUSER: "synthetic-user",
        PGDATABASE: "synthetic-database",
        PGPASSWORD: "synthetic-password",
        PGSSLMODE: "require",
        PGOPTIONS: "-c statement_timeout=1",
        PGAPPNAME: "synthetic-app",
        PGPASSFILE: "/synthetic-parent-password-file",
        NODE_OPTIONS: "--no-warnings",
        EZER_PARENT_SENTINEL: "synthetic-parent",
      },
      timeout: 15000,
    },
  );
  assert.equal(result.status, 0, result.stderr);
});

for (const [failure, expected] of [
  ["connect:1", ["end:1"]],
  ["create", ["end:1"]],
  ["connect:2", ["end:2", "drop", "end:1"]],
  ["mkdir", ["end:2", "drop", "end:1"]],
  ["copy", ["remove", "end:2", "drop", "end:1"]],
] as const) {
  test(`PostgreSQL fixture cleans acquired resources after ${failure} fails`, async (t) => {
    const { create, events, cleanups } = harness(t, [failure]);
    await assert.rejects(create(), /Synthetic failure/);
    assert.equal(cleanups.length, 1);
    const setupCount = events.length;
    await cleanups[0]!();
    assert.deepEqual(events.slice(setupCount), expected);
  });
}

test("PostgreSQL fixture releases every resource after successful setup", async (t) => {
  const { create, events, cleanups } = harness(t);
  await create();
  const setupCount = events.length;
  await cleanups[0]!();
  assert.deepEqual(events.slice(setupCount), [
    "remove",
    "end:2",
    "drop",
    "end:1",
  ]);
});

test("PostgreSQL fixture cleans a secondary connection that fails to connect", async (t) => {
  const { create, events, cleanups } = harness(t, ["connect:3"]);
  const fixture = await create();
  await assert.rejects(fixture.connect(fixture.database), /Synthetic failure/);
  const setupCount = events.length;
  await cleanups[0]!();
  assert.deepEqual(events.slice(setupCount), [
    "end:3",
    "remove",
    "end:2",
    "drop",
    "end:1",
  ]);
});

test("PostgreSQL fixture attempts every cleanup and reports all failures", async (t) => {
  const { create, events, cleanups } = harness(t, [
    "remove",
    "end:2",
    "drop",
    "end:1",
  ]);
  await create();
  const setupCount = events.length;
  await assert.rejects(cleanups[0]!(), (error: unknown) => {
    assert(error instanceof AggregateError);
    assert.equal(error.errors.length, 4);
    return true;
  });
  assert.deepEqual(events.slice(setupCount), [
    "remove",
    "end:2",
    "drop",
    "end:1",
  ]);
});
