import { mkdtempSync, realpathSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

export function createLocalFixture() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "ezer-local-"));
  const clients: Client[] = [];
  return {
    root,
    async connect(
      individual = "alpha",
      options: {
        allowRestore?: boolean;
        dataDirectory?: string;
        entrypoint?: string;
        cwd?: string;
      } = {},
    ) {
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [
          options.entrypoint ??
            fileURLToPath(
              new URL(
                "../../dist/local/entrypoints/local.mjs",
                import.meta.url,
              ),
            ),
          "--individual",
          individual,
          "--data-dir",
          options.dataDirectory ?? join(root, "data"),
          ...(options.allowRestore ? ["--allow-restore"] : []),
        ],
        cwd: options.cwd ?? root,
        stderr: "pipe",
      });
      const client = new Client({ name: "local-acceptance", version: "1.0.0" });
      clients.push(client);
      await client.connect(transport);
      return { client, transport };
    },
    directory(name: string) {
      const path = join(root, name);
      mkdirSync(path, { mode: 0o700 });
      return path;
    },
    async close() {
      for (const client of clients) await client.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
