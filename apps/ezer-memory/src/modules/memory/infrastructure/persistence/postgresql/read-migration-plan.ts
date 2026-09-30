import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export function readMigrationPlan(
  directory = fileURLToPath(new URL("./migrations/", import.meta.url)),
) {
  const files = readdirSync(directory)
    .filter((file) => file.endsWith(".sql") || file.endsWith(".ts"))
    .sort();
  const pins: Record<string, string> = JSON.parse(
    readFileSync(join(directory, "checksums.json"), "utf8"),
  );
  if (files.length === 0 || files.join() !== Object.keys(pins).sort().join())
    throw new Error("PostgreSQL migration manifest mismatch");
  const names: string[] = [];
  for (const file of files) {
    if (
      createHash("sha256")
        .update(readFileSync(join(directory, file)))
        .digest("hex") !== pins[file]
    )
      throw new Error("PostgreSQL migration checksum mismatch");
    if (file.endsWith(".up.sql")) {
      if (!files.includes(file.replace(".up.sql", ".down.sql")))
        throw new Error("PostgreSQL migration pair missing");
      names.push(file.slice(0, -7));
    } else if (file.endsWith(".down.sql")) {
      if (!files.includes(file.replace(".down.sql", ".up.sql")))
        throw new Error("PostgreSQL migration pair missing");
    } else if (file.endsWith(".ts")) {
      names.push(file.slice(0, -3));
    } else throw new Error("Invalid PostgreSQL migration filename");
  }
  names.sort();
  if (
    names.some(
      (name, index) =>
        !new RegExp(`^${String(index + 1).padStart(6, "0")}_\\w+$`).test(name),
    )
  )
    throw new Error("Invalid PostgreSQL migration order");
  return { directory, names };
}
