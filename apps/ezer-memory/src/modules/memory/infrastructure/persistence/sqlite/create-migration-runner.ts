import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import Postgrator from "postgrator";

export function createMigrationRunner(
  database: DatabaseSync,
  directory = fileURLToPath(new URL("./migrations/", import.meta.url)),
): Postgrator {
  const pins: Record<string, string> = JSON.parse(
    readFileSync(join(directory, "checksums.json"), "utf8"),
  );
  const files = readdirSync(directory)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  if (files.join() !== Object.keys(pins).sort().join() || files.length === 0)
    throw new Error("SQLite migration manifest mismatch");
  const up = files.filter((file) => file.includes(".do."));
  if (files.length !== up.length * 2)
    throw new Error("SQLite migration pair missing");
  for (const [index, file] of up.entries()) {
    if (
      !new RegExp(
        `^${String(index + 1).padStart(6, "0")}\\.do\\.\\w+\\.sql$`,
      ).test(file) ||
      !files.includes(file.replace(".do.", ".undo."))
    )
      throw new Error("Invalid SQLite migration order");
  }
  for (const file of files) {
    if (
      createHash("sha256")
        .update(readFileSync(join(directory, file)))
        .digest("hex") !== pins[file]
    )
      throw new Error("SQLite migration checksum mismatch");
  }
  return new Postgrator({
    driver: "sqlite3",
    schemaTable: "schema_migrations",
    migrationPattern: join(directory, "*.sql"),
    execQuery: async (sql) => ({ rows: database.prepare(sql).all() }),
    execSqlScript: async (sql) => {
      database.exec(sql);
    },
  });
}
