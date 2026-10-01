import { describe, expect, it, vi } from "vitest";
import type { AccessControl } from "../src/modules/access/ports/inbound/index.ts";
import { createConnectMemory } from "../src/modules/memory/application/index.ts";
import { createMemoryHttpHandler } from "../src/modules/memory/delivery/index.ts";
import { createMemoryAccessGateway } from "../src/modules/memory/infrastructure/acl/access/index.ts";
import type { MemoryAccessGateway } from "../src/modules/memory/ports/outbound/index.ts";

function provider(): AccessControl {
  return {
    authorize: async () => ({
      ok: true,
      individual: {
        individualId: "ezer-alice",
        capabilities: { readMemory: false, writeMemory: false },
      },
    }),
  };
}

describe("Memory's consumer-owned Access ACL", () => {
  it("copies only identity fields owned by Memory", async () => {
    const individual = {
      individualId: "ezer-alice",
      providerDetail: "synthetic principal",
      capabilities: { readMemory: false, writeMemory: false },
    };
    const access: AccessControl = {
      authorize: async () => ({ ok: true, individual }),
    };
    const gateway = createMemoryAccessGateway(access);
    const result = await gateway.resolveIndividual("synthetic-credential");
    individual.individualId = "ezer-bob";
    expect(result).toEqual({
      status: "authorized",
      individualId: "ezer-alice",
      capabilities: { read: false, write: false },
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
        capabilities: { read: false, write: false },
      });
      expect(authorize).toHaveBeenCalledExactlyOnceWith(credential);
    },
  );

  it.each([
    [
      "UNRECOGNIZED_CREDENTIAL",
      { status: "denied", reason: "identity-required" },
    ],
    [
      "UNASSIGNED_CALLER",
      { status: "denied", reason: "individual-not-granted" },
    ],
    [
      "MISSING_PERMISSION",
      { status: "denied", reason: "connection-not-granted" },
    ],
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

  it.each([
    [true, false],
    [false, true],
    [true, true],
  ])(
    "translates and detaches read=%s write=%s grants",
    async (readMemory, writeMemory) => {
      const capabilities = {
        readMemory,
        writeMemory,
        foreignDetail: "ignored",
      };
      const access: AccessControl = {
        authorize: async () => ({
          ok: true,
          individual: { individualId: "ezer-alice", capabilities },
        }),
      };
      const result = await createConnectMemory(
        createMemoryAccessGateway(access),
      ).execute("synthetic");
      capabilities.readMemory = false;
      capabilities.writeMemory = false;
      expect(result).toEqual({
        ok: true,
        individualId: "ezer-alice",
        capabilities: { read: readMemory, write: writeMemory },
      });
    },
  );

  it("masks foreign exceptions", async () => {
    const access = provider();
    access.authorize = async () => {
      throw new Error("synthetic provider diagnostic");
    };
    const gateway = createMemoryAccessGateway(access);
    expect(await gateway.resolveIndividual(null)).toEqual({
      status: "unavailable",
    });
  });
});

describe("Memory connection use case", () => {
  it("works with a Memory-only gateway and returns detached inbound views", async () => {
    const identity = {
      status: "authorized" as const,
      individualId: "ezer-alice",
      capabilities: { read: false, write: false },
    };
    const gateway: MemoryAccessGateway = {
      resolveIndividual: async () => identity,
    };
    const connection = createConnectMemory(gateway);
    const result = await connection.execute(null);
    identity.individualId = "ezer-bob";
    expect(result).toEqual({
      ok: true,
      individualId: "ezer-alice",
      capabilities: { read: false, write: false },
    });
  });

  it.each([
    ["identity-required", "IDENTITY_REQUIRED"],
    ["individual-not-granted", "INDIVIDUAL_NOT_GRANTED"],
    ["connection-not-granted", "CONNECTION_NOT_GRANTED"],
  ] as const)(
    "preserves the %s denial through its inbound contract",
    async (reason, code) => {
      const gateway: MemoryAccessGateway = {
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
      resolveIndividual: async () => {
        throw new Error("synthetic adapter diagnostic");
      },
    });
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
        individual: {
          individualId,
          capabilities: { readMemory: false, writeMemory: false },
        },
      });
      const mcp = vi.fn(() => ({
        fetch: async () => new Response("unexpected"),
      }));
      const handler = createMemoryHttpHandler(
        createConnectMemory(createMemoryAccessGateway(access)),
        mcp,
        {
          resource: "https://memory.test/mcp",
          authorizationServer: "https://issuer.test/",
          connectionScope: "ezer:connect",
          readScope: "ezer:memory:read",
          writeScope: "ezer:memory:write",
        },
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
