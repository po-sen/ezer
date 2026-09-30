import { parseArgs } from "node:util";
import { createSqliteMigrator } from "../../bootstrap/migrate-sqlite/index.ts";

const usage = "Usage: migrate:sqlite <status|up> --database <file>";
try {
  const { values, positionals } = parseArgs({
    options: { database: { type: "string" }, help: { type: "boolean" } },
    allowPositionals: true,
    strict: true,
  });
  const action = positionals[0];
  if (values.help) console.log(usage);
  else if (
    positionals.length !== 1 ||
    !values.database ||
    !["status", "up"].includes(action!)
  ) {
    console.error(usage);
    process.exitCode = 2;
  } else {
    const migrator = createSqliteMigrator(values.database, action === "status");
    try {
      const result = await (action === "up"
        ? migrator.up()
        : migrator.status());
      console.log(
        JSON.stringify({ adapter: "sqlite", context: "memory", ...result }),
      );
    } finally {
      migrator.close();
    }
  }
} catch {
  // Provider errors can include SQL, database paths, or stored data.
  console.error(
    "SQLite migration failed. Check the database, migration history, and writer lock.",
  );
  process.exitCode = 1;
}
