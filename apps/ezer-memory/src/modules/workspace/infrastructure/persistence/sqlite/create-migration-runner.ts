import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import Postgrator from "postgrator";

export function createMigrationRunner(
  database: DatabaseSync,
  directory: string,
): Postgrator {
  const pins: Record<string, string> = JSON.parse(
    readFileSync(join(directory, "checksums.json"), "utf8"),
  );
  const files = readdirSync(directory)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const up = files.filter((file) => file.includes(".do."));
  if (
    !up.length ||
    files.length !== up.length * 2 ||
    files.join() !== Object.keys(pins).sort().join()
  )
    throw new Error("Workspace migration manifest mismatch");
  for (const [index, file] of up.entries()) {
    if (
      !new RegExp(
        `^${String(index + 1).padStart(6, "0")}\\.do\\.\\w+\\.sql$`,
      ).test(file) ||
      !files.includes(file.replace(".do.", ".undo."))
    )
      throw new Error("Workspace migration pair mismatch");
  }
  for (const file of files) {
    if (
      createHash("sha256")
        .update(readFileSync(join(directory, file)))
        .digest("hex") !== pins[file]
    )
      throw new Error("Workspace migration checksum mismatch");
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
