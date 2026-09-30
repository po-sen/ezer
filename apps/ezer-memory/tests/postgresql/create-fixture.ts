import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const migrations = fileURLToPath(
  new URL(
    "../../src/modules/memory/infrastructure/persistence/postgresql/migrations/",
    import.meta.url,
  ),
);

export async function createFixture(
  after: (cleanup: () => Promise<void>) => void,
) {
  const cleanup: (() => unknown | Promise<unknown>)[] = [];
  after(async () => {
    const errors: unknown[] = [];
    for (const dispose of cleanup.reverse()) {
      try {
        await dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length)
      throw new AggregateError(errors, "Fixture cleanup failed");
  });

  const database = `ezer_migration_${randomUUID().replaceAll("-", "")}`;
  const connect = async (database: string) => {
    const client = new pg.Client({
      host: "127.0.0.1",
      port: 55439,
      user: "ezer_test",
      password: "ezer-test-only",
      database,
      ssl: false,
      connectionTimeoutMillis: 3000,
    });
    cleanup.push(() => client.end());
    await client.connect();
    return client;
  };
  const admin = await connect("ezer_test");
  await admin.query(`CREATE DATABASE ${database}`);
  // This database belongs only to this fixture. Force also handles a failed end().
  cleanup.push(() => admin.query(`DROP DATABASE ${database} WITH (FORCE)`));
  const client = await connect(database);
  const directory = fs.mkdtempSync(join(tmpdir(), "ezer-pg-migration-"));
  cleanup.push(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.cpSync(migrations, directory, { recursive: true });
  return { client, database, directory, connect };
}
