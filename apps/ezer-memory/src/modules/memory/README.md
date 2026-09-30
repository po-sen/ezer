# Memory bounded context

Memory owns sourced text revisions, correction invariants, individual change
ordering, and operation receipts. It does not choose what an agent remembers,
define personality, infer emotions, authorize callers, or provide semantic search.
One bound Durable Object owns one individual's SQLite database. Public HTTP/MCP
continues to expose service information only.

## Architecture correspondence

The reference is Xerno AEP's
[architecture at b4eaa1d](https://github.com/futurenestit/xerno/blob/b4eaa1d2e697d9664b3e6410bbd5af757d97406b/apps/agent-execution-platform/ARCHITECTURE.md).
Its responsibilities and ownership rules apply here; its PostgreSQL, Go, process,
and multi-context topology are not copied into this single-context Worker.

| Reference rule                                       | Implementation                                                                                                                                                         | Evidence                                                                 |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Sections 2-5: inward dependencies, context ownership | Domain is pure; ports have no SDK/native handles; delivery imports inbound ports; SQL adapters stay under persistence                                                  | Architecture import and responsibility tests                             |
| Sections 3-4: domain owns transitions                | `transitionMemory` establishes sourced immutable revisions, correction reasons, version and sequence invariants                                                        | Domain transition/invalid-value/immutability tests                       |
| Sections 4-6: command/query/view ownership           | Inbound ports own independent DTOs; application explicitly maps domain values into detached views; delivery validates unknown wire shapes                              | Application detached-view test and RPC rejection tests                   |
| Section 11: transaction ownership                    | `UnitOfWork.within` scopes focused state, revision, and operation Stores; native transaction/session stays inside infrastructure                                       | Atomic failure injection, escaped-scope and nested/async rejection tests |
| Sections 6, 14: meaningful errors and safe retry     | SQL adapters discard provider errors and raise `PersistenceFault`; application returns `UNAVAILABLE`; delivery separately masks unexpected defects as `INTERNAL_ERROR` | Adapter/application/delivery failure tests                               |
| Section 11: owned versioned migrations               | Numbered SQL pairs, SHA-256 pins, generated bundle, unmodified native migration runner                                                                                 | Migration manifest check and real SQLite lifecycle tests                 |

An append-only revision ledger uses a Store, as the reference permits. There is no
mutable aggregate collection requiring a generic Repository abstraction. Domain
transitions are pure functions receiving time and sequence values; they do not
need an ORM, framework base class, or ambient clock.

## Transaction contract

The application fingerprints and snapshots the request before entering one local
transaction. Within it, it resolves prior operation receipts, reads current owner
state, invokes the domain transition, and persists the revision, sequence, and
receipt atomically. A completed retry returns its original receipt even after a
later correction. Reusing an operation ID for different content is a conflict.

`UnitOfWork` supplies scoped capability interfaces instead of a Go context carrying
a hidden SQL transaction. This is the TypeScript adaptation of the same boundary:
application sees no database handle. The synchronous contract is enforced by types
and a runtime guard; Store capabilities expire when the callback returns or throws.
They stay expired during later transactions. Provider/network/model work never
runs inside the transaction. Nested transactions are rejected.

## Persistence ownership and context separation

`infrastructure/persistence/sqlite/` and
`infrastructure/persistence/durable-object/` independently own their Stores, SQL,
session types, initialization, and migration artifacts. Durable Object also owns
Cloudflare storage access, transactions, and its native KV migration ledger.
Neither adapter imports the other's code, types, or migration bundle. Each folder
can use its own files/children and ancestor contracts; sibling infrastructure
branches are forbidden. Outside infrastructure, adapters implement the context's
outbound ports. Shared ports do not imply shared persistence implementations.
Parent re-export barrels and injected sibling implementations must not bypass this
rule. Architecture checks cover ordinary imports, type imports, and re-exports.
Migration packaging checks all histories separately and never synchronizes them.
The initial SQL bytes are identical to preserve the existing Durable Object data
format and ledger, but each adapter can evolve its own history independently.

The Worker selects Durable Object. SQLite has a Node SQLite migration CLI alongside
its runtime-independent Stores. PostgreSQL has its own schema migration CLI. Neither
backend yet has a standalone memory-serving deployment. The SQLite component test uses a disposable
database and a test-only session, not the production Durable Object adapter.
Public module APIs live in pure `index.ts` barrels containing explicit re-exports
only. Implementations stay in named files. Cross-directory source imports
use those APIs; same-directory implementations reference each other directly. Indexes
do not permit reversed layer dependencies or access to sibling infrastructure through
a parent facade. SQLite keeps its Node migration operations in `sqlite/cli/`, separate
from the portable Store index.

Entrypoints own platform lifecycle and CLI dispatch; bootstrap composes implementations;
delivery owns RPC validation and delegation to inbound ports.
Entrypoints and bootstrap use flat, named files paired one-to-one, without barrels.

The PostgreSQL migration adapter owns a separate
`infrastructure/persistence/postgresql/migrations/` history.
Database dialects, version ledgers, and deployment lifecycles are adapter-specific;
SQLite migration files are not a portable schema or a PostgreSQL upgrade history.
DO keeps its original SQL bytes, checksum pins, and native ledger. SQLite adopts
Postgrator filename conventions without changing its baseline SQL bytes. PostgreSQL
has its own qualified SQL, BIGINT counters, and TIMESTAMPTZ timestamps.

SQLite does not provide PostgreSQL-style `CREATE SCHEMA` namespaces. Its `main`,
`temp`, and attached-database qualifiers name databases, not independent schemas
inside one database. Durable Objects additionally disallow attached databases;
each object's SQLite storage is private to that object. See the
[SQLite ATTACH documentation](https://www.sqlite.org/lang_attach.html) and
[workerd's attachment restriction](https://github.com/cloudflare/workerd/blob/main/src/workerd/util/sqlite.c%2B%2B).

Only Memory exists today. Future SQLite contexts use separate databases (for
Durable Objects, separate context-owned classes/namespaces and instances). The
PostgreSQL deployment direction is one database per independently deployed Ezer,
with one schema per context, context-owned migrations, and restricted runtime
roles. A context needing independent deployment or data management can later use
its own database. Transactions always stay within one context; cross-context SQL,
foreign keys, and transactions are forbidden regardless of physical storage.
Only the memory context is implemented. PostgreSQL memory Stores and service
composition remain future work.

For separate context-owned Durable Objects, a future logical Ezer identity must
map to each context's object; namespace-specific object IDs are not a shared
cross-context identity contract. Integration goes through provider inbound ports
or explicit events, never another context's database. That topology and identity
mapping are not implemented by this directory change.

PostgreSQL is not currently a drop-in adapter: the synchronous Store and Unit of
Work contracts reflect Durable Object SQLite's `transactionSync`. Supporting a
networked PostgreSQL driver also requires an asynchronous port/application design,
its own adapter tests, and an explicit data/identity transfer plan. Pure domain
rules remain independent of the database technology.

## Cloudflare adaptations

These adaptations belong to the memory service, not domain policy. Revisit them
before the first production deployment and whenever the storage provider or
migration library changes; remove a constraint when the replacement provider can
honor the reference mechanism directly. Their scope is limited to this adapter.

1. **Object-local migration lifecycle.** Durable Object SQLite has
   no shared PostgreSQL connection for a central migration command. Cloudflare
   recommends `blockConcurrencyWhile()` during construction. Bootstrap delegates
   migration and identity initialization to the Durable Object adapter before
   requests execute. That adapter owns its transactions, SQL, and migration
   artifacts. Bootstrap contains no SQL, business branching, or retry policy.
2. **Native KV ledger instead of PostgreSQL migration tables.** The pinned
   `durable-utils` runner owns the atomic version ledger. SQLite schemas, advisory
   locks, and golang-migrate's dirty flag are not emulated. A failed batch preserves
   the preceding version and rolls back DDL/data. Unknown future versions fail
   initialization; there is no force/repair endpoint.
3. **Forward recovery instead of decrementing versions.** The library has no Down
   API. SQL reversal pairs remain reviewed, checksummed artifacts and are exercised
   through explicit next-version compensation in isolated tests. Runtime never
   applies them automatically or rewrites its ledger. Reversing the initial schema
   destroys data and requires a separately approved recovery plan plus backups.
4. **Generated SQL packaging.** Workers cannot load repository SQL files at runtime.
   A build script packages those exact bytes into TypeScript and checks SHA-256 pins.
   It does not execute SQL or implement migration ordering at runtime. The library
   alone applies pending migrations. Generated code must not be edited manually.

Cloudflare references:
[initialization and migrations](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/#initialize-storage-and-run-migrations-in-the-constructor),
[SQLite transactions](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/),
and [durable-utils](https://github.com/lambrospetrou/durable-utils#sqlite-schema-migrations).

## Release and validation limits

The current baseline is unreleased and intentionally replaces the earlier PR
schema. Old PR databases are not an upgrade source and are rejected without
modification. Never reset retained databases automatically. After the first
release, baseline SQL and checksum pins are immutable; subsequent changes require
the next continuous pair and a data-preserving upgrade test.

Local evidence covers domain/application behavior, SQLite constraints and failure
rollback, migration lifecycle, individual isolation, concurrent writers, retry
receipts, and recovery after object eviction. It does not establish production
backup/restore, Cloudflare deployment, cross-computer continuity, or native agent
installation. SQLite/PostgreSQL operational commands expose `status` and `up`; no automatic
downgrade or recovery command is exposed. See the [service README](../../../README.md)
for CLI commands, connection handling, transactions, test setup, and limitations.
