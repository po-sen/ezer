import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createMigrationRunner,
  inspectMigrations,
  migrateMemory,
} from "../src/modules/memory/infrastructure/persistence/sqlite/cli/index.ts";

const appRoot = fileURLToPath(new URL("../", import.meta.url));
const source = join(
  appRoot,
  "src/modules/memory/infrastructure/persistence/sqlite/migrations",
);

function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "ezer-sqlite-migration-"));
  t.after(() => rmSync(directory, { recursive: true }));
  cpSync(source, join(directory, "migrations"), { recursive: true });
  return {
    directory,
    path: join(directory, "memory.sqlite"),
    migrations: join(directory, "migrations"),
  };
}

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

function cli(adapter: string, args: string[]) {
  return spawnSync(
    process.execPath,
    [join(appRoot, `src/entrypoints/migrate-${adapter}.ts`), ...args],
    {
      encoding: "utf8",
      // Tests never inherit database credentials or runtime flags from the host.
      env: { PATH: "/usr/bin:/bin" },
      timeout: 15000,
    },
  );
}

test("SQLite CLI has read-only status, persistent upgrades, and safe argument errors", (t) => {
  const { path } = fixture(t);
  const missing = cli("sqlite", ["status", "--database", path]);
  assert.equal(missing.status, 1);
  assert.equal(existsSync(path), false);
  const database = new DatabaseSync(path);
  database.close();
  const status = cli("sqlite", ["status", "--database", path]);
  assert.equal(status.status, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).pending, 1);
  const untouched = new DatabaseSync(path);
  assert.equal(
    untouched.prepare("SELECT count(*) AS count FROM sqlite_master").get()
      ?.count,
    0,
  );
  untouched.close();
  const up = cli("sqlite", ["up", "--database", path]);
  assert.equal(up.status, 0, up.stderr);
  const populated = new DatabaseSync(path);
  populated.exec("INSERT INTO state VALUES (1, 'synthetic-owner', 0)");
  populated.close();
  assert.equal(cli("sqlite", ["up", "--database", path]).status, 0);
  const reopened = new DatabaseSync(path);
  assert.equal(
    reopened.prepare("SELECT individual_id FROM state").get()?.individual_id,
    "synthetic-owner",
  );
  assert.equal(
    reopened
      .prepare("SELECT max(version) AS version FROM schema_migrations")
      .get()?.version,
    1,
  );
  reopened.close();
  const invalid = cli("sqlite", ["--unknown=SYNTHETIC_PRIVATE_MARKER"]);
  assert.equal(invalid.status, 1);
  assert(!invalid.stderr.includes("SYNTHETIC_PRIVATE_MARKER"));
  assert.equal(cli("sqlite", ["down", "--database", path]).status, 2);
  assert.equal(cli("postgresql", ["--help"]).status, 0);
});

test("SQLite rolls back failed upgrades and rejects edited, missing, or newer history", async (t) => {
  const { path, migrations } = fixture(t);
  const database = new DatabaseSync(path);
  t.after(() => database.close());
  await migrateMemory(database, createMigrationRunner(database, migrations));
  database.exec("INSERT INTO state VALUES (1, 'synthetic-owner', 0)");
  writeFileSync(
    join(migrations, "000002.do.test.sql"),
    "CREATE TABLE failed_upgrade (id INTEGER); INSERT INTO missing_table VALUES (1);",
  );
  writeFileSync(
    join(migrations, "000002.undo.test.sql"),
    "DROP TABLE failed_upgrade;",
  );
  pin(migrations);
  await assert.rejects(
    migrateMemory(database, createMigrationRunner(database, migrations)),
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
    database.prepare("SELECT individual_id FROM state").get()?.individual_id,
    "synthetic-owner",
  );
  writeFileSync(
    join(migrations, "000002.do.test.sql"),
    "CREATE TABLE recovered_upgrade (id INTEGER);",
  );
  pin(migrations);
  assert.equal(
    (await migrateMemory(database, createMigrationRunner(database, migrations)))
      .currentVersion,
    2,
  );
  writeFileSync(join(migrations, "000001.do.memory_initial.sql"), "SELECT 1;");
  assert.throws(() => createMigrationRunner(database, migrations), /checksum/);
  pin(migrations);
  await assert.rejects(
    migrateMemory(database, createMigrationRunner(database, migrations)),
    /checksum/,
  );
  database.exec(
    "INSERT INTO schema_migrations (version, md5) VALUES (3, 'synthetic')",
  );
  await assert.rejects(
    inspectMigrations(database, createMigrationRunner(database, migrations)),
    /Unsupported/,
  );
});

test("SQLite serializes runners before reading history and refuses untracked schemas", async (t) => {
  const { path, migrations } = fixture(t);
  const first = new DatabaseSync(path);
  const second = new DatabaseSync(path);
  t.after(() => {
    first.close();
    second.close();
  });
  second.exec("PRAGMA busy_timeout = 10");
  first.exec("BEGIN IMMEDIATE");
  await assert.rejects(
    migrateMemory(second, createMigrationRunner(second, migrations)),
    /locked/,
  );
  first.exec("ROLLBACK");
  await migrateMemory(second, createMigrationRunner(second, migrations));
  first.exec("DELETE FROM schema_migrations WHERE version = 0");
  await assert.rejects(
    migrateMemory(second, createMigrationRunner(second, migrations)),
    /history/,
  );
  first.exec("DROP TABLE schema_migrations");
  await assert.rejects(
    migrateMemory(second, createMigrationRunner(second, migrations)),
    /history/,
  );
});
