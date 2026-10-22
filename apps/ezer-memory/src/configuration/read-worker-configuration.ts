import { z } from "zod";

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
const bindingsSchema = z
  .array(
    z.strictObject({
      subject: z.string().min(1).max(512),
      individualId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/),
    }),
  )
  .min(1)
  .max(256)
  .refine(
    (entries) =>
      new Set(entries.map((entry) => entry.subject)).size === entries.length,
  );
const resourceSchema = httpsUrl.refine(
  (value) => new URL(value).pathname === "/mcp",
);
const schema = z.union([
  z.strictObject({
    issuer: httpsUrl,
    resource: resourceSchema,
    jwksUri: httpsUrl,
    bindings: bindingsSchema,
  }),
  z.strictObject({
    provider: z.literal("cloudflare-access"),
    resource: resourceSchema,
    access: z.strictObject({
      teamDomain: z
        .string()
        .regex(
          /^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.cloudflareaccess\.com$/,
        ),
      audience: z.string().regex(/^[a-f0-9]{64}$/),
    }),
    bindings: bindingsSchema,
  }),
]);

export function readWorkerConfiguration(configuration: unknown) {
  const parsed = schema.safeParse(configuration);
  if (!parsed.success) return undefined;
  const policy = parsed.data;
  const { resource, bindings } = policy;
  const connectionScope = "ezer:connect";
  const readScope = "ezer:memory:read";
  const writeScope = "ezer:memory:write";
  const scopes = [connectionScope, readScope, writeScope, "offline_access"];
  const hosted = "provider" in policy;
  const issuer = hosted ? new URL(resource).origin : policy.issuer;
  return {
    bindings,
    jwt: hosted
      ? undefined
      : {
          issuer,
          audience: resource,
          jwksUri: policy.jwksUri,
          connectionScope,
          readScope,
          writeScope,
        },
    access: hosted ? policy.access : undefined,
    oauth: hosted
      ? { issuer, resource, scopes, connectionScope, readScope, writeScope }
      : undefined,
    http: {
      resource,
      authorizationServer: issuer,
      connectionScope,
      readScope,
      writeScope,
      ...(hosted ? { authorizationScopes: scopes } : {}),
    },
  };
}
