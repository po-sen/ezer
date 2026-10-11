# Cloudflare Access login

Ezer can host its OAuth authorization server in the same Worker as `/mcp`.
`@cloudflare/workers-oauth-provider` owns the OAuth protocol and its KV records.
Cloudflare Access authenticates the person in the browser. The Access bounded
context checks the caller's configured assignment before displaying consent and
again before approving it. Memory continues to use its own Access ACL.

This integration uses a **self-hosted Access application protecting `/authorize`**.
It does not use Access for SaaS OIDC, an upstream OAuth callback, or a shared
client secret. Nothing in the plugin contains credentials.

## Request flow

1. The agent connects to `/mcp` and receives the protected resource metadata URL.
2. Its OAuth client discovers Ezer's authorization server. Clients can use a
   Client ID Metadata Document (CIMD) or dynamic registration (DCR).
3. The browser opens `/authorize`. Cloudflare Access signs in the person through
   the operator's configured identity provider or one-time PIN and applies its
   Allow policy. The Worker independently verifies `Cf-Access-Jwt-Assertion`.
4. Ezer displays the client name/domain, callback host, Ezer identity and requested
   permissions. The person can reduce permissions or deny the request. The
   library supplies browser-bound, short-lived consent handles and anti-framing
   headers. Submissions also require the same origin and current caller/assignment.
5. The library returns an authorization code. The native client exchanges it with
   its PKCE S256 verifier and the exact MCP resource. Access tokens last 15 minutes;
   refresh tokens are issued only when `offline_access` was approved, for a fixed
   seven-day refresh window. Refresh rotation and revocation use the library.
6. Every MCP request validates Ezer's token against the OAuth KV store and checks
   the current assignment. Memory independently enforces read/write capabilities.

An Access browser assertion is never accepted as an MCP access token. Client
labels, cookies and arbitrary request headers cannot choose an Ezer. A grant is
restricted to the individual shown during consent: reassignment requires a new
authorization. Removing the caller's assignment denies subsequent MCP requests.

## Operator setup

These are deployment instructions, not resources provisioned by this repository.
Obtain authorization for the intended Cloudflare account and deployment before
performing the steps. Do not put live credentials in Git or chat.

1. Choose a custom HTTPS hostname, such as `memory.example.com`, and an owned Worker
   deployment. Keep `workers_dev` and preview URLs disabled. Preserve the
   `EZER_MEMORY` namespace and stable individual IDs when updating an installation.
2. Create a dedicated Workers KV namespace for this authorization server and bind
   it as `OAUTH_KV`. Replace the all-zero placeholder ID in deployment configuration.
   Local tests emulate KV without an account. Do not share this namespace between
   independent Ezer deployments or authorization issuers.
3. In Cloudflare Zero Trust, create a self-hosted public Access application for
   **`memory.example.com/authorize`**, covering both GET and POST. Configure its
   identity provider and a restrictive Allow policy. Record the public team domain
   and application audience tag (AUD). Do not use a Bypass policy for this path.
4. Supply the following non-secret `EZER_AUTHORIZATION` JSON binding in the
   deployment configuration. Obtain the authorized person's stable Access user ID
   through the operator's Access user management; use that verified subject, not
   an email address, device name, or decoded credential pasted into chat.
5. Configure the custom-domain route and deploy through an authorized release.
   Leave `/mcp`, `/oauth/token`, `/oauth/register` and `/.well-known/*` outside the
   browser-login Access application. The MCP endpoint has its own bearer-token
   enforcement; wrapping the whole hostname in Access prevents native OAuth login.

Placeholder policy (the audience below is illustrative, not a credential):

```json
{
  "provider": "cloudflare-access",
  "resource": "https://memory.example.com/mcp",
  "access": {
    "teamDomain": "https://your-team.cloudflareaccess.com",
    "audience": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  "bindings": [
    {
      "subject": "access-user-id",
      "individualId": "6f5521bd-1f8f-4f03-9c92-993e4ec58a8b"
    }
  ]
}
```

The resource is a canonical HTTPS URL ending in `/mcp`. Its origin is the OAuth
issuer. The team domain is an exact `https://<team>.cloudflareaccess.com` origin,
without a trailing slash; AUD is the application's 64-character lowercase hex tag.
Access verifies RS256 signatures, issuer, audience, expiry, not-before, issued-at,
the application-token type, and a nonempty subject. Keys are fetched only from the
configured team's `/cdn-cgi/access/certs`, without redirects; caching is bounded
to five minutes with a three-second fetch timeout. Unknown callers are refused.

The committed policy remains `{}` and fails closed. The previous external JWT
configuration remains supported as a separate mode; do not combine its
`issuer`/`jwksUri` fields with `provider: "cloudflare-access"`.

## Client configuration and permissions

Package a plugin instance with its HTTPS `/mcp` URL as described in the
[plugin README](../../plugins/ezer/README.md). Use the host's native OAuth login.
The initial challenge advertises connection, read, write and offline access so a
normal login can support continuity; the person can uncheck permissions on the
consent page. No permission is silently added after approval.

| Scope               | Effect                                                             |
| ------------------- | ------------------------------------------------------------------ |
| `ezer:connect`      | Connect, describe the service, and inspect the bound Ezer identity |
| `ezer:memory:read`  | Read revisions and list memories                                   |
| `ezer:memory:write` | Create memories and append corrections                             |
| `offline_access`    | Receive a rotating refresh token for the seven-day window          |

Connection permission is required, and read/write permissions are independent.
An operator-admitted, assigned person may consent to all three Ezer permissions;
there is no role-administration UI or per-person permission ceiling in this release.
Granting only connection permission cannot read memory contents. A denied tool
returns a bounded MCP error; automatic per-tool HTTP scope step-up is not implemented.
Restart native login to change permissions. Native private-use callback schemes
are not enabled; HTTPS and loopback HTTP callbacks are supported.

`GET /.well-known/oauth-authorization-server` advertises `/authorize`,
`/oauth/token` and `/oauth/register`. RFC 7009 revocation also uses `/oauth/token`:
native clients submit `token`, `token_type_hint` and their client authentication.
Revoking a refresh token revokes its grant; revoking an access token only removes
that token. Reauthorizing the same user/client/resource replaces its prior grant
under the library's default policy, so separately registered devices are preferable.

## Storage, revocation and operation

OAuth records are sensitive. The library owns client registrations, consent
transactions, grants and token records in `OAUTH_KV`; do not inspect or log their
contents. Do not export those records into Memory or plugin bundles. There is no
handwritten OAuth SQL schema, signing-key lifecycle or token format. Cloudflare
Access owns human credentials; the host owns its client-side credentials.

Keep `global_fetch_strictly_public` enabled for CIMD's user-supplied HTTPS metadata
URLs. DCR does not grant access by itself, but is public: apply appropriate edge
rate limits to registration and protocol endpoints before exposing a deployment.
Do not log Authorization/Cookie/Access headers, authorization query strings or
token response bodies in Worker or edge observability.

The verifier does not cache successful token checks. **KV is eventually
consistent**: revocation and one-use state propagation are not globally atomic,
and local tests cannot establish cross-region timing. Access login revocation
does not automatically revoke already-issued Ezer OAuth grants; remove the caller
binding to deny MCP access, or revoke the relevant Ezer grant. Refresh permission
lasts independently of the original Access browser session. This is a deliberate
separation between human sign-in and delegated client access.

Rollback requires restoring compatible code/configuration while preserving both
namespaces. Switching back to external JWT mode requires native clients to sign
in to that issuer again. Do not delete KV or change the Memory routing prefix as a
rollback step. There are no Memory SQL or migration changes in this integration.

## Acceptance evidence and remaining checks

Tests use ephemeral synthetic RSA keys, mocked public key/CIMD documents, local
KV, the actual OAuth library, the MCP SDK and local Durable Objects. They exercise
discovery, registration, consent, PKCE, refresh, revocation, reduced permissions,
identity isolation and denial paths without real accounts or secrets.

After an authorized deployment, separately verify the real Access redirect/login,
native Codex and Claude Code OAuth flows, consent, reconnect/refresh/revocation,
and cross-computer continuity. Confirm that the Access application covers only
the authorization route and that no alternate hostname bypasses the configured
issuer. Passing local tests does not prove these deployment properties.

References: [Workers OAuth Provider](https://github.com/cloudflare/workers-oauth-provider),
[same-Worker resource hosting](https://github.com/cloudflare/workers-oauth-provider/blob/main/docs/resource-servers.md),
[consent helpers](https://github.com/cloudflare/workers-oauth-provider/blob/main/docs/consent-page.md),
[Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/),
and [Access application paths](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/).
