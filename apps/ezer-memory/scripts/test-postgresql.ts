import { fileURLToPath } from "node:url";
import { runIsolatedNode } from "./run-isolated-node.ts";

const result = runIsolatedNode([
  "--test",
  fileURLToPath(
    new URL("../tests/postgresql-fixture.test.ts", import.meta.url),
  ),
  fileURLToPath(
    new URL("../tests/postgresql-migrations.test.ts", import.meta.url),
  ),
]);
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
if (result.error)
  process.stderr.write("PostgreSQL test process failed to run.\n");
process.exitCode = result.status ?? 1;
