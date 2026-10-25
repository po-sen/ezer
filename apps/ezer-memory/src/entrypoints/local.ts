import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { createLocal } from "../bootstrap/create-local.ts";

try {
  const { values } = parseArgs({
    options: {
      individual: { type: "string" },
      "data-dir": { type: "string" },
      "allow-restore": { type: "boolean", default: false },
      help: { type: "boolean" },
    },
    allowPositionals: false,
  });
  if (values.help) {
    console.error(
      "Usage: node local.mjs --individual <stable-id> [--data-dir /absolute/private/directory] [--allow-restore]",
    );
  } else {
    if (!values.individual) throw new Error("Individual required");
    await createLocal({
      individualId: values.individual,
      ...(values["data-dir"] === undefined
        ? {}
        : { dataDirectory: values["data-dir"] }),
      allowRestore: values["allow-restore"],
      memoryMigrations: fileURLToPath(
        new URL(
          "../modules/memory/infrastructure/persistence/sqlite/migrations/",
          import.meta.url,
        ),
      ),
      workspaceMigrations: fileURLToPath(
        new URL(
          "../modules/workspace/infrastructure/persistence/sqlite/migrations/",
          import.meta.url,
        ),
      ),
    }).start();
  }
} catch {
  console.error(
    "Local Ezer could not start. Check Node >=24.5, the individual ID, private data directory, and migration artifacts. No data was reset.",
  );
  process.exitCode = 1;
}
