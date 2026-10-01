import { exports } from "cloudflare:workers";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestAuthority } from "./authorization/index.ts";

afterEach(() => vi.restoreAllMocks());

const endpoint = "https://ezer.test/mcp";

async function connectClient() {
  const authority = await createTestAuthority();
  const token = await authority.sign();
  const client = new Client({ name: "ezer-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    fetch: (input, init) => {
      const request = new Request(input, init);
      request.headers.set("Authorization", `Bearer ${token}`);
      return authority.request(request);
    },
  });
  await client.connect(transport);
  return client;
}

describe("Worker MCP boundary", () => {
  it("serves liveness and keeps unknown routes separate from MCP", async () => {
    const health = await exports.default.fetch("https://ezer.test/health");
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });
    expect(
      (await exports.default.fetch("https://ezer.test/missing")).status,
    ).toBe(404);
    const invalid = await exports.default.fetch("https://ezer.test/health", {
      method: "POST",
    });
    expect(invalid.status).toBe(405);
    expect(invalid.headers.get("Allow")).toBe("GET");
  });

  it("discovers and calls the service without claiming memory is implemented", async () => {
    const client = await connectClient();
    try {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toEqual([
        "ezer_identity",
        "ezer_service_info",
      ]);
      const result = await client.callTool({
        name: "ezer_service_info",
        arguments: {},
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        name: "ezer-memory",
        stage: "foundation",
        capabilities: { memoryRead: false, memoryWrite: false },
      });
    } finally {
      await client.close();
    }
  });

  it("rejects unexpected tool arguments", async () => {
    const client = await connectClient();
    try {
      const result = await client.callTool({
        name: "ezer_service_info",
        arguments: { owner: "untrusted-owner" },
      });
      expect(result.isError).toBe(true);
    } finally {
      await client.close();
    }
  });

  it("also serves legacy stateless clients without treating sessions as memory", async () => {
    const authority = await createTestAuthority();
    const token = await authority.sign();
    async function request(method: string, params: Record<string, unknown>) {
      const response = await authority.request(
        new Request(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
            "MCP-Protocol-Version": "2025-11-25",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        }),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("mcp-session-id")).toBeNull();
      const text = await response.text();
      const data = response.headers
        .get("Content-Type")
        ?.includes("text/event-stream")
        ? text
            .split("\n")
            .find((line) => line.startsWith("data: "))
            ?.slice(6)
        : text;
      expect(data).toBeDefined();
      return JSON.parse(data!);
    }
    const initialized = await request("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "legacy-test", version: "1.0.0" },
    });
    expect(initialized.result.protocolVersion).toBe("2025-11-25");
    const result = await request("tools/call", {
      name: "ezer_service_info",
      arguments: {},
    });
    expect(result.result.structuredContent.capabilities).toEqual({
      memoryRead: false,
      memoryWrite: false,
    });
  });

  it("rejects cross-origin requests before parsing their bodies", async () => {
    const response = await exports.default.fetch(endpoint, {
      method: "POST",
      headers: {
        Origin: "https://untrusted.test",
        "Content-Type": "application/json",
      },
      body: "invalid json",
    });
    expect(response.status).toBe(403);
  });

  it("bounds request bodies and rejects malformed protocol input", async () => {
    const authority = await createTestAuthority();
    const token = await authority.sign();
    const oversized = await authority.request(
      new Request(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          Authorization: `Bearer ${token}`,
        },
        body: " ".repeat(64 * 1024 + 1),
      }),
    );
    expect(oversized.status).toBe(413);
    const malformed = await authority.request(
      new Request(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          Authorization: `Bearer ${token}`,
        },
        body: "{",
      }),
    );
    expect(malformed.status).toBe(400);
  });
});
