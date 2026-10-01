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
const schema = z
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
    (value) =>
      new Set(value.bindings.map((entry) => entry.subject)).size ===
      value.bindings.length,
  );

export function readWorkerConfiguration(configuration: unknown) {
  // Deployment syntax is translated before it reaches context contracts.
  const parsed = schema.safeParse(configuration);
  if (!parsed.success) return undefined;
  const { issuer, resource, jwksUri, bindings } = parsed.data;
  const connectionScope = "ezer:connect";
  return {
    bindings,
    jwt: { issuer, audience: resource, jwksUri, connectionScope },
    http: { resource, authorizationServer: issuer, connectionScope },
  };
}
