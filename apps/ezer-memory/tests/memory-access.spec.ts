import { describe, expect, it, vi } from "vitest";
import type { AccessControl } from "../src/modules/access/ports/inbound/index.ts";
import { createConnectMemory } from "../src/modules/memory/application/index.ts";
import { createMemoryHttpHandler } from "../src/modules/memory/delivery/index.ts";
import { createMemoryAccessGateway } from "../src/modules/memory/infrastructure/acl/access/index.ts";
import type { MemoryAccessGateway } from "../src/modules/memory/ports/outbound/index.ts";

function provider(): AccessControl {
  return {
    describe: () => ({
      resource: "https://memory.test/mcp",
      issuer: "https://issuer.test/",
    }),
    authorize: async () => ({
      ok: true,
      individual: { individualId: "ezer-alice" },
    }),
  };
}

describe("Memory's consumer-owned Access ACL", () => {
  it("copies only the metadata and identity fields owned by Memory", async () => {
    const metadata = {
      resource: "https://memory.test/mcp",
      issuer: "https://issuer.test/",
      providerDetail: "synthetic provider detail",
    };
    const individual = {
      individualId: "ezer-alice",
      providerDetail: "synthetic principal",
    };
    const access: AccessControl = {
      describe: () => metadata,
      authorize: async () => ({ ok: true, individual }),
    };
    const gateway = createMemoryAccessGateway(access);
    const description = gateway.describeResource();
    const result = await gateway.resolveIndividual("synthetic-credential");
    metadata.issuer = "https://changed.test/";
    individual.individualId = "ezer-bob";
    expect(description).toEqual({
      resource: "https://memory.test/mcp",
      authorizationServer: "https://issuer.test/",
    });
    expect(result).toEqual({
      status: "authorized",
      individualId: "ezer-alice",
    });
  });

  it.each([null, "synthetic-credential"])(
    "delegates credential %s without choosing an identity",
    async (credential) => {
      const access = provider();
      const authorize = vi.spyOn(access, "authorize");
      const gateway = createMemoryAccessGateway(access);
      expect(await gateway.resolveIndividual(credential)).toEqual({
        status: "authorized",
        individualId: "ezer-alice",
      });
      expect(authorize).toHaveBeenCalledExactlyOnceWith(credential);
    },
  );

  it.each([
    ["UNAUTHENTICATED", { status: "denied", reason: "authentication" }],
    ["FORBIDDEN", { status: "denied", reason: "permission" }],
    ["INSUFFICIENT_SCOPE", { status: "denied", reason: "scope" }],
    ["UNAVAILABLE", { status: "unavailable" }],
  ] as const)(
    "translates %s into Memory's outbound contract",
    async (code, expected) => {
      const access = provider();
      access.authorize = async () => ({ ok: false, code });
      expect(
        await createMemoryAccessGateway(access).resolveIndividual(null),
      ).toEqual(expected);
    },
  );

  it("masks foreign exceptions and leaves missing metadata unavailable", async () => {
    const access = provider();
    access.describe = () => {
      throw new Error("synthetic provider diagnostic");
    };
    access.authorize = async () => {
      throw new Error("synthetic provider diagnostic");
    };
    const gateway = createMemoryAccessGateway(access);
    expect(gateway.describeResource()).toBeUndefined();
    expect(await gateway.resolveIndividual(null)).toEqual({
      status: "unavailable",
    });
    access.describe = () => undefined;
    expect(gateway.describeResource()).toBeUndefined();
  });
});

describe("Memory connection use case", () => {
  it("works with a Memory-only gateway and returns detached inbound views", async () => {
    const metadata = {
      resource: "https://memory.test/mcp",
      authorizationServer: "https://issuer.test/",
    };
    const identity = {
      status: "authorized" as const,
      individualId: "ezer-alice",
    };
    const gateway: MemoryAccessGateway = {
      describeResource: () => metadata,
      resolveIndividual: async () => identity,
    };
    const connection = createConnectMemory(gateway);
    const description = connection.describe();
    const result = await connection.execute(null);
    metadata.authorizationServer = "https://changed.test/";
    identity.individualId = "ezer-bob";
    expect(description).toEqual({
      resource: "https://memory.test/mcp",
      authorizationServer: "https://issuer.test/",
    });
    expect(result).toEqual({ ok: true, individualId: "ezer-alice" });
  });

  it.each([
    ["authentication", "UNAUTHENTICATED"],
    ["permission", "FORBIDDEN"],
    ["scope", "INSUFFICIENT_SCOPE"],
  ] as const)(
    "preserves the %s denial through its inbound contract",
    async (reason, code) => {
      const gateway: MemoryAccessGateway = {
        describeResource: () => undefined,
        resolveIndividual: async () => ({ status: "denied", reason }),
      };
      expect(await createConnectMemory(gateway).execute(null)).toEqual({
        ok: false,
        code,
      });
    },
  );

  it("fails closed if a replacement gateway throws", async () => {
    const connection = createConnectMemory({
      describeResource: () => {
        throw new Error("synthetic adapter diagnostic");
      },
      resolveIndividual: async () => {
        throw new Error("synthetic adapter diagnostic");
      },
    });
    expect(connection.describe()).toBeUndefined();
    expect(await connection.execute(null)).toEqual({
      ok: false,
      code: "UNAVAILABLE",
    });
  });

  it.each(["", "invalid owner"])(
    "rejects unusable owner %s before invoking MCP",
    async (individualId) => {
      const access = provider();
      access.authorize = async () => ({
        ok: true,
        individual: { individualId },
      });
      const mcp = vi.fn(() => ({
        fetch: async () => new Response("unexpected"),
      }));
      const handler = createMemoryHttpHandler(
        createConnectMemory(createMemoryAccessGateway(access)),
        mcp,
      );
      const response = await handler(new Request("https://memory.test/mcp"));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "temporarily_unavailable",
      });
      expect(mcp).not.toHaveBeenCalled();
    },
  );
});
