import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function runIsolatedNode(args: string[]) {
  const home = mkdtempSync(join(tmpdir(), "ezer-pg-test-home-"));
  try {
    return spawnSync(process.execPath, args, {
      encoding: "utf8",
      // Do not copy the caller's PG, Node, or credential-file configuration.
      env: {
        PATH: "/usr/bin:/bin",
        HOME: home,
        PGPASSFILE: join(home, "unused.pgpass"),
      },
      timeout: 60000,
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}
