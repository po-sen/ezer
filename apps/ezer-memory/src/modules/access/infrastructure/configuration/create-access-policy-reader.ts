import { z } from "zod";
import type { AccessPolicyReader } from "../../ports/outbound/index.ts";

const httpsUrl = z
  .url()
  .max(2048)
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !value.includes("?") &&
      !value.includes("#") &&
      url.href === value
    );
  });
const policySchema = z
  .strictObject({
    issuer: httpsUrl,
    resource: httpsUrl.refine((value) => new URL(value).pathname === "/mcp"),
    jwksUri: httpsUrl,
    bindings: z
      .array(
        z.strictObject({
          subject: z.string().min(1).max(512),
          individualId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/),
        }),
      )
      .min(1)
      .max(256),
  })
  .refine(
    (policy) =>
      new Set(policy.bindings.map((entry) => entry.subject)).size ===
      policy.bindings.length,
  );

export function createAccessPolicyReader(
  configuration: unknown,
): AccessPolicyReader {
  // This is operator-provided policy, never an environment file or a client payload.
  const parsed = policySchema.safeParse(configuration);
  return { read: () => (parsed.success ? parsed.data : undefined) };
}
