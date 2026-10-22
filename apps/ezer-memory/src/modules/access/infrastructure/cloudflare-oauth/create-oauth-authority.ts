import { OAuthAuthorizationServer } from "@cloudflare/workers-oauth-provider";
import type { CredentialVerifier } from "../../ports/outbound/index.ts";

interface Settings {
  readonly issuer: string;
  readonly resource: string;
  readonly scopes: string[];
  readonly connectionScope: string;
  readonly readScope: string;
  readonly writeScope: string;
}

export function createOAuthAuthority(
  settings: Settings,
  env: { OAUTH_KV: KVNamespace },
) {
  const server = new OAuthAuthorizationServer<typeof env>({
    issuer: settings.issuer,
    resources: [settings.resource],
    defaultResource: settings.resource,
    scopesSupported: settings.scopes,
    clientIdMetadataDocumentEnabled: true,
    clientRegistrationEndpoint: "/oauth/register",
    accessTokenTTL: 900,
    refreshTokenTTL: 604800,
    tokenExchangeCallback: ({ scope }) => ({
      refreshTokenTTL: scope.includes("offline_access") ? 604800 : 0,
    }),
    // Do not send provider diagnostics or request data to logs or clients.
    onError: ({ code, status, headers }) =>
      Response.json({ error: code }, { status, headers }),
  });
  const verifier: CredentialVerifier = {
    async verify(credential) {
      if (!credential || credential.length > 8192)
        return { status: "unrecognized" };
      try {
        const token = await server.validateToken<{ individualId?: unknown }>(
          settings.resource,
          credential,
          env,
        );
        if (
          !token ||
          token.audience !== settings.resource ||
          !token.userId ||
          token.userId.length > 512 ||
          token.expiresAt <= Date.now() / 1000 ||
          !token.props ||
          typeof token.props.individualId !== "string" ||
          !token.props.individualId
        )
          return { status: "unrecognized" };
        return {
          status: "verified",
          callerId: token.userId,
          restrictedIndividualId: token.props.individualId,
          permissions: (
            [
              [settings.connectionScope, "connect"],
              [settings.readScope, "read-memory"],
              [settings.writeScope, "write-memory"],
            ] as const
          ).flatMap(([scope, permission]) =>
            token.scope.includes(scope) ? [permission] : [],
          ),
        };
      } catch {
        return { status: "unavailable" };
      }
    },
  };
  return {
    verifier,
    oauth: server.getOAuthApi(env),
    fetch: (request: Request, context: ExecutionContext) =>
      server.fetch(request, env, context),
  };
}
