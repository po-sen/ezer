# Access bounded context

## Domain

Access determines whether an external caller may connect to Ezer and which
logical individual that caller is authorized to use. It translates a verified
external identity into a server-owned Ezer binding. It does not define the
individual's personality or store its memories.

## Responsibilities

- Validate access tokens against the configured authority and resource audience.
- Require the `ezer:connect` scope and an operator-configured subject binding.
- Return the authorized logical individual ID without exposing credentials or
  provider-specific claims to Memory.
- Expose public issuer/resource metadata through its inbound contract so HTTP
  delivery can implement protected-resource discovery.
- Fail closed when policy is missing or invalid, and report bounded failure codes
  without leaking provider errors.

## Core concepts and owned data

| Concept   | Meaning and ownership                                                                                                  |
| --------- | ---------------------------------------------------------------------------------------------------------------------- |
| Authority | The trusted issuer and its public JWKS endpoint. The external provider issues tokens; Access verifies them.            |
| Resource  | The configured MCP audience for this deployment. A token must be intended for this resource.                           |
| Subject   | The verified caller identifier within the configured issuer. It is distinct from the Ezer individual ID.               |
| Binding   | An operator-owned mapping from one subject to one logical individual. Multiple subjects may share the same individual. |
| Scope     | `ezer:connect` permits the current connection and identity tools; it does not grant future memory-content operations.  |

Access owns interpretation and validation of this policy, supplied through the
explicit `EZER_AUTHORIZATION` Worker binding. It currently has no database,
migration history, or persisted sessions. The JWT adapter caches public keys only;
it does not retain bearer tokens or manage user credentials. Binding changes are
operator configuration changes, not actions available to the agent.

## Public contracts and collaboration

Cross-context consumers must explicitly import the
[inbound port index](ports/inbound/index.ts). The context's root barrel also
exposes these contracts, but is not an allowed cross-context import path:

- `AccessControl.describe()` returns configured public issuer/resource metadata.
- `AccessControl.authorize(token)` returns the authorized logical individual or
  `UNAUTHENTICATED`, `FORBIDDEN`, `INSUFFICIENT_SCOPE`, or `UNAVAILABLE`.
- `AuthorizedIndividual` carries only `individualId` across the context boundary.

Only [Memory](../memory/README.md)'s consumer-owned
[Access ACL](../memory/infrastructure/acl/access/index.ts) consumes these contracts.
That adapter implements Memory's own outbound port, translating resource metadata,
authorized identities, and denial codes into Memory-owned results. Access makes
the authorization decision; the ACL does not repeat that policy. Memory delivery
uses its own connection use case and never imports Access types.

The dependency is one-way: Memory's ACL depends on Access's inbound API. Translating
both requests and responses does not create a reverse dependency. Access does not
import Memory, reuse its ACL, open its database, or select a Durable Object. There
is no shared transaction. Bootstrap composes the two contexts through the adapter.

Bootstrap composes the use case with `AccessPolicyReader` and
`AccessTokenVerifier` outbound ports. The configuration and JWT adapters remain
independent infrastructure branches. There is no separate domain layer until
domain models need responsibilities beyond this access policy use case.

## Outside this context

Access does not implement login, consent, token issuance, refresh, account
provisioning, or credential storage; these belong to the external authorization
provider and host OAuth client. It does not choose memory contents, corrections,
personality, emotions, or recall behavior. HTTP/MCP protocol handling belongs to
delivery, and physical memory isolation belongs to Memory's persistence adapter.

## Current implementation limits

The JWT adapter accepts RS256/ES256 RFC 9068 access tokens. ID tokens, opaque
tokens, and API keys are unsupported. Individual token revocation is not
introspected; removing a subject's configured grant denies subsequent requests.
One subject maps to one individual per endpoint; multiple independently deployed
Ezers can use different resource audiences and bindings.

Tests use synthetic tokens and a mocked public JWKS endpoint. A live provider's
login flow and native host compatibility still require acceptance testing. See
the [service README](../../../README.md) for operator configuration, provider
requirements, public-key caching, and deployment limitations.
