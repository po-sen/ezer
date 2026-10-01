# Access bounded context

## Domain

Access determines whether a verified caller may connect to Ezer and which
logical individual that caller is authorized to use. Its language is callers,
connection/read/write permissions, assignments, and authorization decisions. It does not define the
individual's personality or store its memories.

## Responsibilities

- Obtain verified caller facts through an implementation-independent credential port.
- Require connection permission and exactly one assignment for the caller.
- Return the authorized logical individual ID and explicit memory capabilities without exposing credentials or
  provider-specific claims to Memory.
- Reject ambiguous assignments and recheck current assignment policy for each request.
- Fail closed when policy is missing or invalid, and report bounded failure codes
  without leaking provider errors.

## Core concepts and owned data

| Concept    | Meaning and ownership                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------ |
| Credential | Opaque proof submitted by a caller. The application does not parse its format.                               |
| Caller     | An identity established by the selected verifier. Its `callerId` is distinct from the Ezer individual ID.    |
| Permission | Access owns `connect`, `read-memory`, and `write-memory`. None implies either of the others.                 |
| Assignment | A server-owned mapping from one caller to one individual. Multiple callers may share the same individual.    |
| Decision   | A granted individual or a bounded denial/unavailability result, independent of HTTP status and OAuth errors. |

Access owns interpretation of assignment policy. It currently has no database,
migration history, or persisted sessions. The JWT adapter caches public keys only;
it does not retain bearer tokens or manage user credentials. Binding changes are
operator configuration changes, not actions available to the agent.

## Public contracts and collaboration

Cross-context consumers must explicitly import the
[inbound port index](ports/inbound/index.ts). The context's root barrel also
exposes these contracts, but is not an allowed cross-context import path:

- `AccessControl.authorize(credential)` returns the authorized logical individual or
  `UNRECOGNIZED_CREDENTIAL`, `UNASSIGNED_CALLER`, `MISSING_PERMISSION`, or `UNAVAILABLE`.
- `AuthorizedIndividual` carries `individualId` and `readMemory`/`writeMemory`
  capabilities across the context boundary. No provider claims are exported.

Only [Memory](../memory/README.md)'s consumer-owned
[Access ACL](../memory/infrastructure/acl/access/index.ts) consumes these contracts.
That adapter implements Memory's own outbound port, translating authorized
identities and Access decisions into Memory-owned results. Access makes
the authorization decision; the ACL does not repeat that policy. Memory delivery
uses its own connection use case and never imports Access types.

The dependency is one-way: Memory's ACL depends on Access's inbound API. Translating
both requests and responses does not create a reverse dependency. Access does not
import Memory, reuse its ACL, open its database, or select a Durable Object. There
is no shared transaction. Bootstrap composes the two contexts through the adapter.

Bootstrap composes the use case with `AccessPolicyReader` and `CredentialVerifier`
outbound ports. Policy contains only caller assignments. Verification accepts
opaque proof and returns a caller ID with Access permissions, unrecognized proof,
or unavailability. A replacement verifier needs no JWT fields or provider URLs in
its contract. The configuration and JWT adapters remain independent infrastructure
branches. There is no separate domain layer until
domain models need responsibilities beyond this access policy use case.

## Adapter translations

The service's [deployment configuration](../../configuration/index.ts) validates
the explicit `EZER_AUTHORIZATION` binding before bootstrap composes adapters.
The configuration adapter maps deployment `subject` bindings to Access `callerId`
assignments and returns detached policy snapshots. The JWT adapter receives its
issuer, audience, JWKS URL, and scope mapping through factory settings. Those
values never pass through `AccessPolicy`, `CredentialVerifier`, or a use-case call.
The adapter translates verified `sub` and `scope` claims into caller facts and the
`connect`, `read-memory`, and `write-memory` permissions. Deployment settings map
these to exact `ezer:connect`, `ezer:memory:read`, and `ezer:memory:write` scope values.
The application requires connection permission and derives the granted content
capabilities. Memory's ACL translates them to its own `read`/`write` capabilities;
Memory enforces them before each operation. Key retrieval, algorithm selection,
and caching stay in the JWT adapter.

OAuth discovery metadata goes directly from deployment settings to HTTP delivery.
It is not an Access use case. Core tests use an opaque ticket and a synthetic
verifier without JWT, HTTP, or a live provider; integration tests separately verify
the JWT adapter and protocol behavior.

## Outside this context

Access does not implement login, consent, token issuance, refresh, account
provisioning, or credential storage; these belong to the external authorization
provider and host OAuth client. It does not choose memory contents, corrections,
personality, emotions, or recall behavior. OAuth metadata and HTTP/MCP protocol handling belong to
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
