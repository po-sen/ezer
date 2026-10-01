import { describe, expect, it, vi } from "vitest";
import { createAccessControl } from "../src/modules/access/application/index.ts";
import type {
  AccessPolicy,
  CredentialVerifier,
} from "../src/modules/access/ports/outbound/index.ts";
import { createAccessPolicyReader } from "../src/modules/access/infrastructure/configuration/index.ts";

describe("Access-owned authorization semantics", () => {
  const policy: AccessPolicy = {
    assignments: [{ callerId: "caller-a", individualId: "ezer-a" }],
  };

  it("authorizes an opaque proof using only caller, permission, and assignment facts", async () => {
    const verify = vi.fn<CredentialVerifier["verify"]>(async () => ({
      status: "verified",
      callerId: "caller-a",
      permissions: ["connect"],
    }));
    const control = createAccessControl({ read: () => policy }, { verify });
    expect(await control.authorize("synthetic-ticket")).toEqual({
      ok: true,
      individual: { individualId: "ezer-a" },
    });
    expect(verify).toHaveBeenCalledExactlyOnceWith("synthetic-ticket");
  });

  it.each([
    [{ status: "unrecognized" }, "UNRECOGNIZED_CREDENTIAL"],
    [{ status: "unavailable" }, "UNAVAILABLE"],
    [
      { status: "verified", callerId: "unknown", permissions: ["connect"] },
      "UNASSIGNED_CALLER",
    ],
    [
      { status: "verified", callerId: "caller-a", permissions: [] },
      "MISSING_PERMISSION",
    ],
  ] satisfies [Awaited<ReturnType<CredentialVerifier["verify"]>>, string][])(
    "returns a domain decision for %j",
    async (caller, code) => {
      const control = createAccessControl(
        { read: () => policy },
        { verify: async () => caller },
      );
      expect(await control.authorize("synthetic-ticket")).toEqual({
        ok: false,
        code,
      });
    },
  );

  it("rechecks assignments without caching granted connections", async () => {
    let current = policy;
    const control = createAccessControl(
      { read: () => current },
      {
        verify: async () => ({
          status: "verified",
          callerId: "caller-a",
          permissions: ["connect"],
        }),
      },
    );
    expect((await control.authorize("synthetic-ticket")).ok).toBe(true);
    current = { assignments: [] };
    expect(await control.authorize("synthetic-ticket")).toEqual({
      ok: false,
      code: "UNASSIGNED_CALLER",
    });
  });

  it("rejects ambiguous assignments from any policy implementation", async () => {
    const control = createAccessControl(
      {
        read: () => ({
          assignments: [
            ...policy.assignments,
            { callerId: "caller-a", individualId: "ezer-b" },
          ],
        }),
      },
      {
        verify: async () => ({
          status: "verified",
          callerId: "caller-a",
          permissions: ["connect"],
        }),
      },
    );
    expect(await control.authorize("synthetic-ticket")).toEqual({
      ok: false,
      code: "UNAVAILABLE",
    });
  });

  it("fails closed for missing policy and masks dependency failures", async () => {
    const verify = vi.fn<CredentialVerifier["verify"]>(async () => {
      throw new Error("synthetic diagnostic");
    });
    for (const read of [
      () => undefined,
      () => {
        throw new Error("synthetic diagnostic");
      },
    ]) {
      expect(
        await createAccessControl({ read }, { verify }).authorize(null),
      ).toEqual({ ok: false, code: "UNAVAILABLE" });
    }
    expect(verify).not.toHaveBeenCalled();
    expect(
      await createAccessControl({ read: () => policy }, { verify }).authorize(
        "synthetic-ticket",
      ),
    ).toEqual({ ok: false, code: "UNAVAILABLE" });
  });

  it("the configuration adapter snapshots provider bindings into Access assignments", () => {
    const bindings = [{ subject: "caller-a", individualId: "ezer-a" }];
    const reader = createAccessPolicyReader(bindings);
    bindings[0]!.subject = "caller-b";
    const first = reader.read();
    expect(first).toEqual(policy);
    expect(reader.read()).not.toBe(first);
    expect(reader.read()!.assignments[0]).not.toBe(first!.assignments[0]);
    expect(createAccessPolicyReader(undefined).read()).toBeUndefined();
  });
});
