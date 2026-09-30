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

## Cloudflare adaptations

These adaptations belong to the memory service, not domain policy. Revisit them
before the first production deployment and whenever the storage provider or
migration library changes; remove a constraint when the replacement provider can
honor the reference mechanism directly. Their scope is limited to this adapter.

1. **Object-local lifecycle instead of `cmd/migrate`.** Durable Object SQLite has
   no shared PostgreSQL connection for a central migration command. Cloudflare
   recommends `blockConcurrencyWhile()` during construction. Bootstrap delegates
   migration and identity initialization to separate persistence functions before
   requests execute. It contains no SQL, business branching, or retry policy.
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
installation. No general-purpose production migration/recovery command is exposed.
