import { parseArgs } from "node:util";
import { createPostgresqlMigrator } from "../../bootstrap/migrate-postgresql/index.ts";

const usage =
  "Usage: migrate:postgresql <status|up> --database <name> [--host <host>] [--port <port>] [--user <user>]. Supply credentials through the deployment environment.";
try {
  const { values, positionals } = parseArgs({
    options: {
      database: { type: "string" },
      host: { type: "string" },
      port: { type: "string" },
      user: { type: "string" },
      help: { type: "boolean" },
    },
    allowPositionals: true,
    strict: true,
  });
  const action = positionals[0];
  if (values.help) console.log(usage);
  else if (
    positionals.length !== 1 ||
    !values.database ||
    !["status", "up"].includes(action!) ||
    (values.port !== undefined &&
      (!/^\d+$/.test(values.port) ||
        Number(values.port) < 1 ||
        Number(values.port) > 65535))
  ) {
    console.error(usage);
    process.exitCode = 2;
  } else {
    const migrator = createPostgresqlMigrator({
      database: values.database,
      ...(values.host === undefined ? {} : { host: values.host }),
      ...(values.port === undefined ? {} : { port: Number(values.port) }),
      ...(values.user === undefined ? {} : { user: values.user }),
    });
    try {
      await migrator.connect();
      const result = await (action === "up"
        ? migrator.up()
        : migrator.status());
      console.log(
        JSON.stringify({ adapter: "postgresql", context: "memory", ...result }),
      );
    } finally {
      await migrator.close();
    }
  }
} catch {
  // Never print provider errors, connection details, SQL, or environment values.
  console.error(
    "PostgreSQL migration failed. Check connectivity, permissions, migration history, and the migration lock.",
  );
  process.exitCode = 1;
}
