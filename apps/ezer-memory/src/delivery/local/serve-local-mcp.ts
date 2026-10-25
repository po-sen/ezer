import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

export function serveLocalMcp(
  version: string,
  register: readonly ((server: McpServer) => void)[],
) {
  return serveStdio(
    () => {
      const server = new McpServer({ name: "ezer-local", version });
      for (const setup of register) setup(server);
      return server;
    },
    {
      onerror: () => {
        console.error("Local MCP transport failed");
      },
    },
  );
}
