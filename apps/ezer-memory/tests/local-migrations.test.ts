import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createLocalFixture } from "./local/index.ts";
import {
  createMigrationRunner,
  inspectMigrations,
  migrateWorkspace,
} from "../src/modules/workspace/infrastructure/persistence/sqlite/index.ts";

const source = fileURLToPath(
  new URL(
    "../src/modules/workspace/infrastructure/persistence/sqlite/migrations/",
    import.meta.url,
  ),
);
const entry = fileURLToPath(
  new URL("../src/entrypoints/migrate-workspace.ts", import.meta.url),
);
function pin(directory: string) {
  const pins = Object.fromEntries(
    readdirSync(directory)
      .filter((file) => file.endsWith(".sql"))
      .sort()
      .map((file) => [
        file,
        createHash("sha256")
          .update(readFileSync(join(directory, file)))
          .digest("hex"),
      ]),
  );
  writeFileSync(join(directory, "checksums.json"), JSON.stringify(pins));
}

test("Workspace migration status never creates schema and CLI errors do not echo arguments", async (t) => {
  const fixture = createLocalFixture();
  t.after(() => fixture.close());
  const path = join(fixture.root, "workspace.sqlite");
  const cli = (args: string[]) =>
    spawnSync(process.execPath, [entry, ...args], {
      encoding: "utf8",
      timeout: 10000,
      env: { PATH: "/usr/bin:/bin" },
    });
  assert.equal(cli(["status", "--database", path]).status, 1);
  assert.equal(existsSync(path), false);
  const database = new DatabaseSync(path);
  t.after(() => database.close());
  assert.equal(cli(["status", "--database", path]).status, 0);
  assert.equal(
    database.prepare("SELECT count(*) AS count FROM sqlite_master").get()
      ?.count,
    0,
  );
  assert.equal(cli(["up", "--database", path]).status, 0);
  database
    .prepare("INSERT INTO workspace_state VALUES (1, ?, 0)")
    .run("synthetic-owner");
  assert.equal(cli(["up", "--database", path]).status, 0);
  assert.equal(
    database.prepare("SELECT individual_id FROM workspace_state").get()
      ?.individual_id,
    "synthetic-owner",
  );
  assert.equal(cli(["down", "--database", path]).status, 2);
  const invalid = cli(["--unknown=SYNTHETIC_PRIVATE_ARGUMENT"]);
  assert.equal(invalid.status, 1);
  assert.ok(!invalid.stderr.includes("SYNTHETIC_PRIVATE_ARGUMENT"));
});

test("Workspace migrations roll back failed upgrades and reject damaged or unsupported history", async (t) => {
  const fixture = createLocalFixture();
  t.after(() => fixture.close());
  const directory = join(fixture.root, "migrations");
  mkdirSync(directory);
  for (const file of readdirSync(source))
    copyFileSync(join(source, file), join(directory, file));
  const database = new DatabaseSync(join(fixture.root, "workspace.sqlite"));
  t.after(() => database.close());
  await migrateWorkspace(database, createMigrationRunner(database, directory));
  database
    .prepare("INSERT INTO workspace_state VALUES (1, ?, 0)")
    .run("synthetic-owner");
  writeFileSync(
    join(directory, "000002.do.test.sql"),
    "CREATE TABLE failed_upgrade (id INTEGER); INSERT INTO missing_table VALUES (1);",
  );
  writeFileSync(
    join(directory, "000002.undo.test.sql"),
    "DROP TABLE failed_upgrade;",
  );
  pin(directory);
  await assert.rejects(
    migrateWorkspace(database, createMigrationRunner(database, directory)),
  );
  assert.equal(
    database
      .prepare("SELECT name FROM sqlite_master WHERE name = 'failed_upgrade'")
      .get(),
    undefined,
  );
  assert.equal(
    database
      .prepare("SELECT max(version) AS version FROM schema_migrations")
      .get()?.version,
    1,
  );
  assert.equal(
    database.prepare("SELECT individual_id FROM workspace_state").get()
      ?.individual_id,
    "synthetic-owner",
  );
  // The failed synthetic migration was never published or committed.
  writeFileSync(
    join(directory, "000002.do.test.sql"),
    "CREATE TABLE recovered_upgrade (id INTEGER);",
  );
  pin(directory);
  assert.equal(
    (
      await migrateWorkspace(
        database,
        createMigrationRunner(database, directory),
      )
    ).currentVersion,
    2,
  );
  writeFileSync(
    join(directory, "000001.do.workspace_initial.sql"),
    "SELECT 1;",
  );
  assert.throws(() => createMigrationRunner(database, directory), /checksum/);
  pin(directory);
  await assert.rejects(
    migrateWorkspace(database, createMigrationRunner(database, directory)),
    /checksum/,
  );
  database.exec(
    "INSERT INTO schema_migrations (version, md5) VALUES (3, 'synthetic')",
  );
  await assert.rejects(
    inspectMigrations(database, createMigrationRunner(database, directory)),
    /Unsupported/,
  );
  database.exec("DELETE FROM schema_migrations WHERE version = 1");
  database.exec("DELETE FROM schema_migrations WHERE version = 3");
  await assert.rejects(
    inspectMigrations(database, createMigrationRunner(database, directory)),
    /history/,
  );
  const untracked = new DatabaseSync(":memory:");
  t.after(() => untracked.close());
  untracked.exec("CREATE TABLE untracked (id INTEGER)");
  await assert.rejects(
    migrateWorkspace(untracked, createMigrationRunner(untracked, directory)),
    /no migration history/,
  );
});
