import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runIsolatedNode } from "../scripts/index.ts";
import { createFixture } from "./postgresql/index.ts";
import {
  inspectMigrations,
  migrateMemory,
  readMigrationPlan,
} from "../src/modules/memory/infrastructure/persistence/postgresql/index.ts";

const appRoot = fileURLToPath(new URL("../", import.meta.url));
function pin(directory: string) {
  const files = readdirSync(directory)
    .filter((file) => file.endsWith(".sql") || file.endsWith(".ts"))
    .sort();
  writeFileSync(
    join(directory, "checksums.json"),
    JSON.stringify(
      Object.fromEntries(
        files.map((file) => [
          file,
          createHash("sha256")
            .update(readFileSync(join(directory, file)))
            .digest("hex"),
        ]),
      ),
    ),
  );
}

test("PostgreSQL CLI upgrades only memory and status never creates a schema", async (t) => {
  const { client, database } = await createFixture((cleanup) =>
    t.after(cleanup),
  );
  const run = (action: string) =>
    runIsolatedNode([
      join(appRoot, "src/entrypoints/migrate-postgresql.ts"),
      action,
      "--database",
      database,
      "--host",
      "127.0.0.1",
      "--port",
      "55439",
      "--user",
      "ezer_test",
    ]);
  const status = run("status");
  assert.equal(status.status, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).pending, 1);
  assert.equal(
    (await client.query("SELECT to_regnamespace('memory') AS schema")).rows[0]
      .schema,
    null,
  );
  await client.query(
    "CREATE SCHEMA unrelated; CREATE TABLE unrelated.marker (id INTEGER); INSERT INTO unrelated.marker VALUES (42)",
  );
  const up = run("up");
  assert.equal(up.status, 0, up.stderr);
  await client.query(
    "INSERT INTO memory.state VALUES (1, 'synthetic-owner', 0)",
  );
  assert.equal(run("up").status, 0);
  assert.equal(
    (await client.query("SELECT individual_id FROM memory.state")).rows[0]
      .individual_id,
    "synthetic-owner",
  );
  assert.equal(
    (await client.query("SELECT id FROM unrelated.marker")).rows[0].id,
    42,
  );
  assert.equal(
    (
      await client.query(
        "SELECT count(*)::int AS count FROM memory.schema_migrations",
      )
    ).rows[0].count,
    1,
  );
});

test("PostgreSQL failed migration rolls back its SQL and ledger while preserving earlier versions", async (t) => {
  const { client, directory } = await createFixture((cleanup) =>
    t.after(cleanup),
  );
  await migrateMemory(client, readMigrationPlan(directory));
  await client.query(
    "INSERT INTO memory.state VALUES (1, 'synthetic-owner', 0)",
  );
  writeFileSync(
    join(directory, "000002_failure.up.sql"),
    "CREATE TABLE memory.failed_upgrade (id INTEGER); SELECT 1 / 0;",
  );
  writeFileSync(
    join(directory, "000002_failure.down.sql"),
    "DROP TABLE memory.failed_upgrade;",
  );
  pin(directory);
  await assert.rejects(migrateMemory(client, readMigrationPlan(directory)));
  assert.equal(
    (await client.query("SELECT to_regclass('memory.failed_upgrade') AS name"))
      .rows[0].name,
    null,
  );
  assert.equal(
    (await inspectMigrations(client, readMigrationPlan(directory).names))
      .currentVersion,
    1,
  );
  assert.equal(
    (await client.query("SELECT individual_id FROM memory.state")).rows[0]
      .individual_id,
    "synthetic-owner",
  );
  writeFileSync(
    join(directory, "000002_failure.up.sql"),
    "CREATE TABLE memory.recovered_upgrade (id INTEGER);",
  );
  pin(directory);
  assert.equal(
    (await migrateMemory(client, readMigrationPlan(directory))).currentVersion,
    2,
  );
  await client.query(
    "INSERT INTO memory.schema_migrations (name, run_on) VALUES ('000003_future', NOW())",
  );
  await assert.rejects(
    migrateMemory(client, readMigrationPlan(directory)),
    /Unsupported/,
  );
});

test("PostgreSQL migration lock prevents a concurrent runner and is released afterward", async (t) => {
  const { client, database, directory, connect } = await createFixture(
    (cleanup) => t.after(cleanup),
  );
  const other = await connect(database);
  await other.query("SELECT pg_advisory_lock(1770131713)");
  await assert.rejects(
    migrateMemory(client, readMigrationPlan(directory)),
    /already running/,
  );
  assert.equal(
    (await client.query("SELECT to_regnamespace('memory') AS schema")).rows[0]
      .schema,
    null,
  );
  await other.query("SELECT pg_advisory_unlock(1770131713)");
  await migrateMemory(client, readMigrationPlan(directory));
  assert.equal(
    (await other.query("SELECT pg_try_advisory_lock(1770131713) AS acquired"))
      .rows[0].acquired,
    true,
  );
});

test("PostgreSQL supports the library's explicit per-migration transaction opt-out", async (t) => {
  const { client, directory } = await createFixture((cleanup) =>
    t.after(cleanup),
  );
  await migrateMemory(client, readMigrationPlan(directory));
  writeFileSync(
    join(directory, "000002_concurrent_index.ts"),
    'export function up(pgm) { pgm.noTransaction(); pgm.sql("CREATE INDEX CONCURRENTLY memory_recorded_at ON memory.revisions(recorded_at)"); }',
  );
  pin(directory);
  assert.equal(
    (await migrateMemory(client, readMigrationPlan(directory))).currentVersion,
    2,
  );
  assert.equal(
    (
      await client.query(
        "SELECT indisvalid FROM pg_index WHERE indexrelid = 'memory.memory_recorded_at'::regclass",
      )
    ).rows[0].indisvalid,
    true,
  );
});
