import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { createWorkspaceMigrator } from "../bootstrap/create-workspace-migrator.ts";

try {
  const { values, positionals } = parseArgs({
    options: { database: { type: "string" } },
    allowPositionals: true,
  });
  const action = positionals[0];
  if (
    positionals.length !== 1 ||
    !values.database ||
    !["status", "up"].includes(action!)
  ) {
    console.error("Usage: migrate:workspace <status|up> --database <file>");
    process.exitCode = 2;
  } else {
    const migrator = createWorkspaceMigrator(
      values.database,
      fileURLToPath(
        new URL(
          "../modules/workspace/infrastructure/persistence/sqlite/migrations/",
          import.meta.url,
        ),
      ),
      action === "status",
    );
    try {
      const result = await (action === "up"
        ? migrator.up()
        : migrator.status());
      console.log(
        JSON.stringify({ adapter: "sqlite", context: "workspace", ...result }),
      );
    } finally {
      migrator.close();
    }
  }
} catch {
  console.error(
    "Workspace migration failed. Check the database, migration history, and writer lock.",
  );
  process.exitCode = 1;
}
