# Ezer memory service

This package implements Ezer's independent memory service in TypeScript on
Cloudflare Workers. The MCP endpoint requires an authorized connection.
An internal SQLite-backed Durable Object stores sourced text memories and their
revision history. OAuth JWT access-token validation and Ezer identity binding are
implemented. Public memory read/write tools, login-provider provisioning, model
invocation, and cloud deployment are not implemented.

## Development

From the repository root, use the pinned pnpm version and run
`pnpm install --frozen-lockfile`, then:

| Command                                       | Purpose                                                     |
| --------------------------------------------- | ----------------------------------------------------------- |
| `pnpm --filter @ezer/memory dev`              | Start Wrangler locally on loopback.                         |
| `pnpm --filter @ezer/memory types`            | Regenerate Worker bindings, entry-point, and runtime types. |
| `pnpm --filter @ezer/memory types:check`      | Check that committed generated types are current.           |
| `pnpm --filter @ezer/memory typecheck`        | Regenerate types, then check source and tests.              |
| `pnpm --filter @ezer/memory test`             | Run architecture, Node SQLite CLI, and workerd tests.       |
| `pnpm --filter @ezer/memory migrations:check` | Check SQL pairs, checksums, and generated bundle.           |
| `pnpm --filter @ezer/memory build`            | Produce a local bundle using `wrangler deploy --dry-run`.   |
| `pnpm run check`                              | Run the repository's full CI validation.                    |

No Cloudflare login or project secrets are needed for these checks. The local URL
belongs to the machine running Wrangler. It does not prove connectivity from a
different computer. Public workers.dev and preview URLs are disabled in the
configuration; a real deployment requires a separate, authorized setup.

## Interfaces

- `GET /health` returns liveness, not memory-store readiness.
- `/mcp` serves Streamable HTTP using the official MCP SDK. Modern requests and
  legacy stateless clients use the same tool registration. Request bodies are
  limited to 64 KiB; browser requests with a foreign Origin are rejected.
- `ezer_service_info` takes no arguments and reports the service version, its
  `foundation` stage, and disabled memory read/write capabilities.
- `ezer_identity` takes no arguments and returns the bound logical `individualId`
  and current `changeSequence`. It never returns memory contents, the principal,
  credentials, or a Cloudflare object ID.
- `GET /.well-known/oauth-protected-resource/mcp` publishes the configured OAuth
  resource, issuer, and required `ezer:connect` scope without authentication.

Every MCP request is authenticated before protocol/body parsing. Protocol sessions
never determine durable identity. Memory contents and mutations remain private to
the internal binding; identity lookup reads only the authorized object's sequence.
The current tests use synthetic MCP clients; native plugin installation and real
Codex/Claude Code compatibility still require separate acceptance tests.

## Authorization and stable identity

The Access bounded context validates a principal and resolves a server-owned Ezer
binding. Memory's consumer-owned ACL is the only cross-context adapter and imports
Access's explicit `ports/inbound/index.ts`. It implements Memory's outbound access
gateway, translating provider results into Memory-owned contracts. HTTP/MCP delivery
uses Memory's own inbound connection use case and never imports Access types.
This is a one-way dependency from Memory to Access, with request/response mapping
inside the ACL. Access owns neither memory SQL nor transactions.
Its configuration and JWT adapters are independent and consume only outbound ports.
No account database or custom login/token-issuing protocol is introduced.

The operator supplies the non-secret JSON binding `EZER_AUTHORIZATION` through
trusted deployment configuration. The committed default is `{}`: `/mcp` and
resource metadata return `503` until the policy is valid; `/health` remains live.
The following is a placeholder example, not a deployed service or a credential:

```json
{
  "issuer": "https://login.example.com/",
  "resource": "https://memory.example.com/mcp",
  "jwksUri": "https://login.example.com/jwks",
  "bindings": [
    {
      "subject": "provider-assigned-subject",
      "individualId": "d5d3c3dc-6517-48c5-a2e5-f41437016894"
    }
  ]
}
```

Use the authority's exact issuer and public JWKS endpoint. URLs must be canonical
HTTPS URLs without user information, queries, or fragments. The resource must end
at `/mcp`, match the request origin, and be the audience issued to this service.
The authority must support the MCP clients' OAuth discovery/login flow and issue
RFC 9068 JWT access tokens (`typ: at+jwt` or `application/at+jwt`) signed with RS256
or ES256. `jose` verifies signature, issuer, audience, expiry, and not-before time;
the required `sub`, `iat`, `exp`, `client_id`, and `jti` claims are also checked.
ID tokens, opaque tokens, shared API keys, and token-supplied JWKS URLs are not
supported by this adapter. It fetches only the operator-configured public key URL,
does not follow redirects, and never forwards the incoming bearer credential.

The token needs `ezer:connect`, and its verified subject must have exactly one
binding at this endpoint. Multiple subjects can bind to the same Ezer, allowing
different devices or provider subject identifiers to share an individual. Unknown
principals and insufficient scopes receive `403`; missing, invalid, or expired
tokens receive `401` with a resource-metadata challenge. Provider failures return
`503` without private diagnostics. Authorization is checked on every request;
headers, query parameters, tool arguments, sessions, and extra token claims cannot
select another Ezer. Query parameters on the MCP endpoint are rejected.

Choose a stable opaque individual ID (a UUID is recommended), not a display name.
The Durable Object adapter maps it to `ezer:v1:<individualId>` within `EZER_MEMORY`.
The first identity lookup may initialize that object's internal memory schema.
Changing agents, tokens, subjects, or sessions does not change this mapping.
Preserve the ID, routing prefix, and DO namespace across deployments. Changing an
ID selects a different object; it is not a rename or migration. Internal RPC
receipts retain their storage-local object IDs; public identity uses the logical
ID. Existing randomly addressed test objects are not automatically adopted.

Each deployment can operate independently. To give one principal multiple Ezers,
use separate service endpoints/deployments with distinct OAuth resource audiences
and their own bindings. This version intentionally has no client-selected Ezer or
membership administration API. Removing a subject binding denies subsequent
requests, including tokens whose signing keys are cached. Device revocation and
refresh-token management belong to the authorization server/client. Individual
JWT revocation is not introspected: use short-lived access tokens, and verify the
provider's revocation behavior before deployment. Public signing keys are cached
for at most five minutes with a three-second fetch timeout and thirty-second
unknown-key refresh cooldown.

Signing keys and login credentials stay with the external authorization provider.
The host's OAuth client manages access and refresh credentials outside skills,
tool arguments, memory, and Git. This resource server needs no private signing
key or client secret. Worker configuration is read from explicit `env` bindings;
the official `nodejs_compat_do_not_populate_process_env` flag prevents those
bindings from also becoming ambient Node environment variables.

Local tests use ephemeral synthetic signing keys and a mocked public key endpoint;
they run the actual verifier, HTTP/MCP boundary, and DO storage. They do not prove
a provider's login UX, native host compatibility, remote deployment, or
cross-computer continuity. Deployment and provider configuration remain separate
authorized work.

References: [MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization),
[RFC 9068](https://www.rfc-editor.org/rfc/rfc9068.html), and
[jose](https://github.com/panva/jose).

## Code ownership

The [memory context README](src/modules/memory/README.md) maps the implementation to the
referenced Xerno architecture, including explicit Cloudflare adaptations and their
validation. Commands, queries, and detached views belong to `ports/inbound/`;
revision invariants belong to `domain/`; application services coordinate one
`UnitOfWork` with focused state, revision, and operation Stores.

Persistence has three independent folders under `modules/memory/infrastructure/persistence/`:

- `sqlite/` owns its SQL Stores, session contract, identity statements, and migration
  artifacts without Cloudflare types. Its Node SQLite migration CLI manages a local
  database file. A standalone memory-serving process is not implemented.
- `durable-object/` owns its own Stores, session, SQL, migration artifacts, native
  transactions, and KV migration ledger. The Worker selects this implementation.

- `postgresql/` owns PostgreSQL SQL, its `memory` schema, and a node-pg-migrate
  runner. This adds migration operations, not a PostgreSQL memory-serving adapter.

No adapter imports another, including types or migrations. Infrastructure
depends on its own files and ancestor contracts, and implements the context's
outbound ports. Bootstrap selects implementations. Similar SQL is maintained
independently; sharing a database engine does not couple their migration histories.

Each Store uses a scoped SQL session and cannot begin or commit transactions.
Infrastructure normalizes SQL failures; application maps them to use-case failures;
delivery validates wire shape and returns bounded results. Bootstrap composes these
implementations. `src/entrypoints/worker.ts` is Wrangler's main module;
it also owns the Durable Object class, Cloudflare lifecycle, and RPC delegation.
`src/bootstrap/create-worker.ts` composes both the HTTP and Durable Object handlers.
Operational CLI entrypoints live alongside the Worker entrypoint, but are excluded from the Worker
bundle. `src/bootstrap/` contains composition factories and `src/modules/` contains
bounded contexts. Build tooling stays under `scripts/`.

Entrypoints and bootstrap currently have equal file counts and pair one-to-one:

| Entrypoint              | Bootstrap                       |
| ----------------------- | ------------------------------- |
| `worker.ts`             | `create-worker.ts`              |
| `migrate-sqlite.ts`     | `create-sqlite-migrator.ts`     |
| `migrate-postgresql.ts` | `create-postgresql-migrator.ts` |

Each entrypoint imports only its corresponding bootstrap module and permitted
platform APIs. Both directories stay flat, use named implementation files, and
have no indexes. A bootstrap module cannot be shared by multiple entrypoints.
These two directories and all `index.ts` modules allow multiple exports. Other
repository-owned TypeScript modules allow at most one exported name, including
types and re-exports; zero exports are allowed. Only the official generated Worker
declaration file is additionally exempt. Migration arrays and reversal arrays
are generated into separate single-export modules. Architecture and export
tests enforce these rules, including configuration and root development scripts.

Across source directories, import the directory's explicit `index.ts` public API.
References to named bootstrap and entrypoint files are the only source-module
exception; bootstrap still imports context modules through their indexes.
Every `index.ts` contains only explicit re-export declarations, with no imports,
local declarations, functions, classes, initialization, or other executable code.
Within a directory, reference implementation files directly to avoid importing
back through their own barrel. Indexes preserve DDD and adapter ownership; checks
follow imported declarations through named, type, namespace, and chained re-exports.
Every other source module directory has an index, including grouping directories. Pure
SQL/file-discovered migration resources, tests, and build scripts do not need empty
barrels. Context grouping indexes expose inbound contracts; persistence grouping
exports are type-only so they do not combine incompatible runtimes.

SQLite's portable Stores are exported from `persistence/sqlite/index.ts`; its Node
migration operations live under `persistence/sqlite/cli/index.ts`. Their SQL history
remains in the same adapter's `migrations/` directory. The Worker imports only its
selected Durable Object adapter; the dry-run build checks that standalone database
drivers and migration tools stay out of the Worker bundle.

`worker-configuration.d.ts` is generated by the official `wrangler types` command
from `wrangler.jsonc`, the Worker entry point, and Wrangler's bundled runtime.
It includes `Cloudflare.GlobalProps.mainModule`, so integration tests can type-check
`exports.default.fetch()` from `cloudflare:workers` without a handwritten shim.
This application-level declaration emits no runtime code and is outside the
bounded context. Business types remain in regular `.ts` files.

Follow [Cloudflare's TypeScript workflow](https://developers.cloudflare.com/workers/languages/typescript/):
run `pnpm --filter @ezer/memory types` after changing the Worker configuration,
exports, or Wrangler version, and commit the generated file with those changes.
Never edit or format it manually. `dev` and `typecheck` regenerate it; the full
check first runs `wrangler types --check` so stale committed types fail CI before
regeneration. `tsconfig.json` checks the Worker dependency graph with generated declarations.
`tsconfig.cli.json` checks Node CLI/build tooling without Cloudflare declarations.
`tests/tsconfig.json` covers the test suites. Worker types are not hand-maintained.

The explicit `secrets.required` list is empty because this foundation needs no
secrets. Wrangler uses this list for type generation instead of inferring secret
names from local environment files. Add only required names to this list when
bindings are implemented; never put secret values in the configuration.

Keep ports focused on actual use cases. The Unit of Work callback
is synchronous and must not perform network calls or return a Promise; the Durable
Object adapter runs it with `storage.transactionSync()`. Fingerprinting finishes before
entering the transaction. Do not create generic repositories or empty layers.

Inner layers must not import Cloudflare, MCP, HTTP, storage clients, environment
configuration, or another context. Domain rules receive time and identity as
values. Application code coordinates domain behavior through ports; delivery
validates wire input and translates use-case results. Bootstrap owns composition,
not business policy. The architecture tests enforce the current import allowlist;
runtime coupling still needs review.

## Internal persistence

`EZER_MEMORY` is a Worker binding, not a public endpoint. Each object owns one
SQLite database and persists its object ID as its internal individual identity.
Callers holding the binding select the object; `commit` and `inspect` accept no
individual, owner, session, or database selector. Storage isolation is not user
authorization. The authenticated identity adapter selects the object using only
the server-authorized logical ID. Future memory tools must use that same boundary,
never an unchecked client-supplied individual ID.

The internal RPC contract is provisional and is not the released plugin/MCP
contract. Its methods return `{ ok: true, value }` or `{ ok: false, code }`:

| Method                                                                                      | Behavior                                                                                                                                                             |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inspectState()`                                                                            | Read only the current change sequence for the bound object's identity metadata.                                                                                      |
| `commit({ kind: "remember", operationId, memoryId, body, source })`                         | Create revision 1 of a new memory. Reusing a memory ID with a new operation returns `ALREADY_EXISTS`.                                                                |
| `commit({ kind: "revise", operationId, memoryId, expectedRevision, body, source, reason })` | Append an immutable revision if the current version matches. Missing memories return `NOT_FOUND`; stale versions return `REVISION_CONFLICT`.                         |
| `inspect({ memoryId, revision? })`                                                          | Read the latest or an exact historical revision, plus the current individual change sequence in the same snapshot. Missing memories or revisions return `NOT_FOUND`. |

`source` contains a non-empty `reference` and `excerpt`. These are caller-reported
provenance, not independently verified evidence or instructions to execute.
Every correction stores a full new content/source snapshot and a reason; previous
versions remain inspectable. Memory and operation IDs use 1-128 ASCII letters,
digits, `.`, `_`, `:`, or `-`, starting with a letter or digit. Limits are measured
in JavaScript UTF-16 code units: body 16,384, source reference 1,024, source excerpt
4,096, and correction reason 1,024. Text is preserved verbatim; blank text and
unknown fields are rejected with `INVALID_INPUT`.

Successful writes return an individual ID, memory ID, revision, recorded timestamp,
and change sequence. The revision, sequence, and operation receipt commit in one
transaction. Different writes get increasing sequences; concurrent corrections
of one expected revision allow only one success. Failed writes do not consume a
sequence or reserve an operation ID.

Operation IDs are scoped to an individual and retained without a TTL in this
foundation. A fixed-field, versioned SHA-256 request fingerprint detects mismatched
replays without duplicating memory bodies in the operation table. Retrying the
same operation and content returns its original receipt even after subsequent
corrections or object eviction. Reusing its ID with different content returns
`OPERATION_CONFLICT`. Storage failures become a `PersistenceFault` inside
infrastructure and then `UNAVAILABLE` in application, without SQL details; retry
using the original operation ID, since this response
does not establish whether a write committed. Connection failures may still throw
before RPC delivery and require the same retry discipline. Unexpected programming
failures become `INTERNAL_ERROR` in delivery and must not be classified as transient
storage outages. An exhausted safe-integer sequence returns `CAPACITY_EXCEEDED`.

### Schema and lifecycle

Wrangler declares the SQLite class using its official `exports` configuration,
with the `EZER_MEMORY` binding. The pinned Wrangler supports this configuration;
it must not be combined with the legacy `migrations` array. This declaration does
not provision anything until a separately authorized deployment.

Each adapter owns versioned migrations and checksum pins in its own `migrations/`
directory. DO uses `000001_name.up.sql` / `.down.sql`; SQLite uses Postgrator's
`000001.do.name.sql` / `.undo.sql`; PostgreSQL uses node-pg-migrate's native paired
`.up.sql` / `.down.sql` loader. DO and SQLite also have generated bundles.
Renaming SQLite's unreleased baseline to Postgrator's format preserves its SQL bytes.
DO's baseline SQL, checksum values, ledger key, and RPC contract are unchanged. The active Worker's runner reads only
`src/modules/memory/infrastructure/persistence/durable-object/migrations/`.
`durable-utils@0.3.7`, recommended in Cloudflare's migration documentation, owns
SQL execution and the atomic native KV version ledger. The runner is not patched.
Before serving requests, the object initializes that runner inside
`blockConcurrencyWhile()`, then separately initializes/checks its bound identity.
There is no public migration endpoint or production deployment in this change.

```sh
pnpm --filter @ezer/memory migrations:generate
pnpm --filter @ezer/memory migrations:check
```

The first command records each adapter's reviewed SHA-256 pins and packages DO/SQLite
SQL into generated TypeScript. PostgreSQL loads its own SQL files directly. The second checks each history for missing
pairs, version gaps, changed bytes, and a stale bundle. Neither command copies or
synchronizes one adapter's migrations into another. CI only checks; it does not
regenerate or silently accept changed SQL. Generated modules are build output
committed for bundling, not handwritten
DDL. Normal development and build commands validate it before starting. Once a
baseline is released, its files and checksum pins are immutable; append the next
continuous pair for every correction.

This is a new, unreleased baseline. Databases from the earlier PR implementation
are rejected without modification; resetting any retained development database
requires an explicit owner decision. Existing data is never reset automatically.
An unknown/newer version is also rejected, preserving its data.

The Durable Object library is forward-only. Paired `.down.sql` files document and test
reversals; they are not an automatic downgrade API. Tests exercise them as explicit
next-version compensating migrations, keeping the native ledger monotonic. A
baseline reversal deletes memory data and cannot restore it; a real recovery needs
a separately authorized, reviewed plan and verified backups. Do not edit the
library ledger, rename/delete a namespace, or assume reverting code rolls back data.
A failed DO batch rolls back SQL and native version progress together. Tests prove this behavior and a retry with a new runner.

The identity is stable within its namespace across clients and object eviction.
Cross-account migration and restore need an explicit identity/epoch strategy;
this first schema is not an import format. Permanent deletion, export, restore,
epoch handling, inference dependencies, and semantic search are not implemented.
Reads are currently by memory ID and optional revision only.

The Workers tests use isolated synthetic databases. They verify actual SQLite
rollback by forcing operation-receipt insertion to fail after revision insertion,
and verify persistence by evicting an object and reconnecting to its existing ID.
This demonstrates storage recovery within the local Workers runtime, not a cloud
deployment, a full host restart, or cross-computer/native-agent continuity.
The SQLite component test clears its disposable fixture and independently applies
the SQLite folder's migrations and Stores through a test-only session. This covers
those components on the test runtime's SQLite engine. Additional Node SQLite and
real PostgreSQL tests cover CLI status, fresh/repeated migration, failure rollback,
unknown histories, writer/advisory locks, and PostgreSQL transaction opt-out.

Official references: [SQLite storage and transactions](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/),
[class exports](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/),
and [Durable Object tests](https://developers.cloudflare.com/durable-objects/examples/testing-with-durable-objects/).

## Operational migration commands

These Node commands are maintenance entrypoints, not part of the Worker bundle.
They operate only on the memory context; other contexts must own separate files
(SQLite) or schemas and migration ledgers (PostgreSQL). They never select a backend
for the running Worker, which still uses Durable Objects.

```sh
pnpm --filter @ezer/memory migrate:sqlite status --database /path/to/memory.sqlite
pnpm --filter @ezer/memory migrate:sqlite up --database /path/to/memory.sqlite
pnpm --filter @ezer/memory migrate:postgresql status --database ezer --host db.example --user ezer_migrator
pnpm --filter @ezer/memory migrate:postgresql up --database ezer --host db.example --user ezer_migrator
```

`status` reads history and reports `{ adapter, context, currentVersion, targetVersion,
pending }`; it never initializes a schema. SQLite status opens an existing file
read-only and fails if the file is absent. `up` initializes or applies pending
migrations. Exit codes are 0 for success, 2 for invalid command usage, and 1 for
parse/provider/history failures. Provider errors are masked to avoid disclosing
SQL, credentials, database paths, or stored data. There is no down/force/repair API.

Stop the standalone SQLite service before `up`, then restart it after a successful
upgrade. Postgrator runs inside `BEGIN IMMEDIATE`, including its history checks
and ledger writes; failure rolls back the pending batch. File paths are explicit,
and a busy writer fails after a bounded wait. Older untracked schemas are refused.

Run PostgreSQL `up` once as a release step before starting the new application
version. The deployment runner needs a direct/session-stable connection to the
database; do not use transaction-pooling connections for session advisory locks.
It holds the memory-specific advisory lock across validation and execution.
node-pg-migrate creates the `memory` schema and `memory.schema_migrations` table;
each ordinary migration commits its SQL and ledger entry together. On failure,
the current migration rolls back while previously completed migrations remain.
Use additive schema changes compatible with the old application during rollout.
The library's native TypeScript migration API supports `pgm.noTransaction()` for
operations such as concurrent indexes. Such operations require a reviewed recovery
plan because they cannot roll back atomically. Keep DDL in reviewed SQL artifacts.

PostgreSQL uses the driver's standard connection environment for credentials and
TLS configuration. Provision those outside chat and Git; there is no password or
connection-URL CLI option, and these commands do not load environment files.
The deployment role needs schema/migration privileges; a future runtime role should
have only its context's required DML privileges. No roles or cloud credentials are
provisioned here. The caller remains responsible for selecting the intended target.

The SHA-256 manifest validates on-disk artifacts before execution. Postgrator also
checks applied migration content against its stored checksums. node-pg-migrate
tracks names/order, not historical content checksums in PostgreSQL, so its released
SQL and reviewed checksum pins must remain immutable in version control.

## Database test service

`pnpm test` includes architecture, Node SQLite CLI, and workerd tests.
`pnpm --filter @ezer/memory test:postgresql` and the full `pnpm run check` additionally
require a disposable PostgreSQL server at `127.0.0.1:55439`, with database/user
`ezer_test`. The tests create uniquely named databases and remove them afterward;
never point this port at retained data. GitHub Actions provisions this service.
For local testing, verify your Docker target before creating a dedicated container:

```sh
docker run -d --name ezer-migration-tests --mount type=tmpfs,destination=/var/lib/postgresql -p 127.0.0.1:55439:5432 -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_USER=ezer_test -e POSTGRES_DB=ezer_test postgres:18.6-alpine
pnpm run check
docker rm -f ezer-migration-tests
```

Local and CI tests use PostgreSQL 18.6. PostgreSQL 18+ images require the tmpfs
mount at `/var/lib/postgresql` to cover their version-specific data directory.
Passwordless access is limited to the disposable loopback test service. The test
command starts the whole suite with an explicit environment allowlist, a temporary
home, and an unused password-file path. It never copies host PG or Node settings.
CLI subprocesses use the same isolation. Use `test:postgresql` rather than invoking
the PostgreSQL test files directly. Fixtures register cleanup before connecting;
partial initialization and cleanup failures still attempt all acquired resources.
All test data is disposable; the test container must be removed when finished.

## Next capabilities

Add scoped private memory tools on MCP using the authenticated individual binding.
`ezer:connect` authorizes identity lookup, not public memory content operations.
Native provider login, plugin installation, and cross-computer
continuity still require separate acceptance tests. R2 remains a later attachment
candidate and is not bound or provisioned here.
