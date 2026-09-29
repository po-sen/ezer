import { execFileSync } from "node:child_process";
import { lstatSync } from "node:fs";
import { join } from "node:path";

// Inspect index paths and filesystem metadata only, before any formatter runs.
const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const entries = execFileSync(
  "git",
  ["ls-files", "--cached", "--format=%(objectmode) %(path)", "-z"],
  { encoding: "utf8", cwd: root },
)
  .split("\0")
  .filter(Boolean);

const localDirectories = new Set([
  ".proof-runs",
  ".venv",
  ".wrangler",
  "__pycache__",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".aws",
  ".ssh",
  ".gnupg",
]);

function rejectionReason(mode: string, path: string): string | undefined {
  const parts = path.split("/");
  const name = parts.at(-1)!;
  if (parts.some((part) => /^(?:\.env|\.dev\.vars)(?:\.|$)/i.test(part))) {
    return "environment files must stay outside Git";
  }
  if (
    /^(?:\.?credentials|\.?secrets|auth\.json|\.npmrc|\.pypirc)(?:\.|$)/i.test(
      name,
    )
  ) {
    return "credential files must stay outside Git";
  }
  if (
    /\.(?:pem|key|p12|pfx|keystore)$/i.test(name) ||
    /^id_(?:rsa|dsa|ecdsa|ed25519)$/i.test(name)
  ) {
    return "key material must stay outside Git";
  }
  if (parts.some((part) => localDirectories.has(part.toLowerCase()))) {
    return "local dependencies, build output, or experiment data";
  }
  if (/\.(?:db|sqlite|sqlite3)(?:-(?:wal|shm|journal))?$/i.test(name)) {
    return "local database files must stay outside Git";
  }
  if (mode === "120000") {
    return "symbolic links are not supported by the formatting hook";
  }

  // Also reject a working-tree symlink that differs from the staged file.
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    let metadata;
    try {
      metadata = lstatSync(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }
    if (metadata.isSymbolicLink()) {
      return "the working-tree path traverses a symbolic link";
    }
  }
}

let rejected = false;
for (const entry of entries) {
  const separator = entry.indexOf(" ");
  const mode = entry.slice(0, separator);
  const path = entry.slice(separator + 1);
  const reason = rejectionReason(mode, path);
  if (reason) {
    console.error(`Blocked path ${JSON.stringify(path)}: ${reason}.`);
    rejected = true;
  }
}

if (rejected) {
  console.error("Remove blocked paths from the index, then retry the commit.");
  process.exitCode = 1;
}
