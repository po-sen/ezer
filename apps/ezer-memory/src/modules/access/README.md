# Access bounded context

## Domain

Access determines whether a verified caller may connect to Ezer and which
logical individual that caller is authorized to use. Its language is callers,
connection/read/write/restore permissions, assignments, and authorization decisions. It does not define the
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
| Permission | Access owns `connect`, `read-memory`, `write-memory`, and `restore-memory`. None implies any of the others.  |
| Assignment | A server-owned mapping from one caller to one individual. Multiple callers may share the same individual.    |
| Decision   | A granted individual or a bounded denial/unavailability result, independent of HTTP status and OAuth errors. |

Access owns interpretation of assignment policy and consented client grants. Its
Cloudflare OAuth adapter uses the official library's KV records for registrations,
consent transactions, grants and tokens. That library owns the storage format;
there is no Access SQL migration history. JWT and Cloudflare Access adapters cache
public keys only. Binding changes are operator configuration changes, not actions
available to the agent.

## Public contracts and collaboration

Cross-context consumers must explicitly import the
[inbound port index](ports/inbound/index.ts). The context's root barrel also
exposes these contracts, but is not an allowed cross-context import path:

- `AccessControl.authorize(credential)` returns the authorized logical individual or
  `UNRECOGNIZED_CREDENTIAL`, `UNASSIGNED_CALLER`, `MISSING_PERMISSION`, or `UNAVAILABLE`.
- `AuthorizedIndividual` carries `callerId`, `individualId` and `readMemory`/`writeMemory`/`restoreMemory`
  capabilities across the context boundary. No provider claims are exported.

Access HTTP delivery also consumes the inbound authorization contract to identify
the consenting caller. The caller ID is not copied into Memory. Across contexts,
only [Memory](../memory/README.md)'s consumer-owned
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
opaque proof and returns a caller ID with Access permissions and an optional
`restrictedIndividualId`, unrecognized proof, or unavailability. The application
rejects a restriction that differs from the current assignment. This is an
Access-owned grant constraint, independent of token format or storage. A replacement verifier needs no JWT fields or provider URLs in
its contract. Configuration, JWT, Cloudflare Access and Cloudflare OAuth adapters remain
independent infrastructure branches. There is no separate domain layer until
domain models need responsibilities beyond this access policy use case.

## Adapter translations

The service's [deployment configuration](../../configuration/index.ts) validates
the explicit `EZER_AUTHORIZATION` binding before bootstrap composes adapters.
The configuration adapter maps deployment `subject` bindings to Access `callerId`
assignments and returns detached policy snapshots. The JWT adapter receives its
issuer, audience, JWKS URL, and scope mapping through factory settings. Those
values never pass through `AccessPolicy`, `CredentialVerifier`, or a use-case call.
The adapter translates verified `sub` and `scope` claims into caller facts and the
`connect`, `read-memory`, `write-memory`, and `restore-memory` permissions. Deployment settings map
these to exact `ezer:connect`, `ezer:memory:read`, `ezer:memory:write`, and `ezer:memory:restore` scope values.
The application requires connection permission and derives the granted content
capabilities. Memory's ACL translates them to its own `read`/`write`/`restore` capabilities;
Memory enforces them before each operation. Key retrieval, algorithm selection,
and caching stay in the JWT adapter.

OAuth discovery metadata goes directly from deployment settings to HTTP delivery.
It is not an Access use case. Core tests use an opaque ticket and a synthetic
verifier without JWT, HTTP, or a live provider; integration tests separately verify
the JWT adapter and protocol behavior.

### Cloudflare Access and hosted OAuth

The `cloudflare-access/` adapter validates the browser's opaque proof against the
configured Access application's public keys, issuer and audience, then maps the
verified subject into caller facts. An admitted person can consent to connection,
read, write, and restore permissions; narrower client grants are chosen on the consent page.
The adapter does not accept host labels, cookies or raw headers as identity facts.

Access delivery calls the existing `AccessControl.authorize` use case for both
GET and POST consent requests. It displays the assigned Ezer, escapes client data,
and uses the OAuth library's browser-bound consent helpers. It checks submission
origin and current caller/assignment before issuing a grant. The resulting grant
contains the consented individual ID, but never a native storage object ID.

The independent `cloudflare-oauth/` adapter hosts `OAuthAuthorizationServer` and
validates the resource-bound opaque tokens it issued. It maps the library's user,
approved scopes and encrypted grant properties into Access-owned caller facts,
permissions and an individual restriction. It does not import or call the other
infrastructure adapters. Refresh is issued only after approval of `offline_access`.
The domain/application/ports never import the library or carry its protocol types.

Service-level HTTP routing dispatches to Access and Memory delivery without
context knowledge. Bootstrap selects the configured verifier and composes handlers;
it does not handle consent, transform claims or route protocol requests itself.

## Outside this context

Cloudflare Access owns human sign-in, identity-provider configuration, account
provisioning and login credentials. Native host clients own their credentials.
Access does not choose memory contents, corrections, personality, emotions or recall
behavior. MCP handling belongs to Memory delivery, and physical memory isolation
belongs to Memory's persistence adapter. There is no Access-to-Memory dependency.

## Current implementation limits

External JWT mode accepts RS256/ES256 RFC 9068 access tokens; it does not introspect
individual token revocation. Hosted mode supports official-library opaque tokens,
15-minute access tokens, seven-day refresh grants and the library's revocation
endpoint. Neither mode accepts Access browser assertions on `/mcp`.

Assignments are rechecked per MCP request. Hosted grants are bound to the consented
individual, so reassignment cannot move an old grant to a different Ezer. One caller
maps to one individual per endpoint; independent deployments use distinct audiences,
OAuth KV namespaces and bindings. Removing an assignment denies subsequent requests.

OAuth KV is eventually consistent; globally atomic replay prevention or instant
cross-region revocation is not promised. Ending an Access browser session does not
revoke Ezer grants already issued to native clients. There is no membership or grant
administration UI, per-person permission ceiling, or automatic scope step-up for
individual MCP tools. See the [login guide](../../../AUTHORIZATION.md).

Tests use ephemeral synthetic signing keys, mocked public key/CIMD endpoints, local
KV, the actual OAuth library and MCP SDK. A live Access deployment, native host
login and cross-computer continuity still require separate acceptance tests.

## Restore permission

Access independently owns `restore-memory`, translated to `ezer:memory:restore`
only in JWT/OAuth adapters. `AuthorizedIndividual.restoreMemory` crosses the
registered ACL as Memory's own `restore` capability. Connection, read, write,
and restore imply none of the others. Cloudflare Access browser verification
makes this capability eligible for explicit OAuth consent, whose checkbox is
unchecked by default. Existing grants do not acquire it. Memory owns archive
validation and empty-target decisions; Access owns neither restore data nor
restore transactions.
