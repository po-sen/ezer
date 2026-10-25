# Workspace bounded context

## Domain and responsibilities

Workspace owns one individual's durable files: logical paths, binary contents,
immutable versions, current locations, trash and retry receipts. The agent chooses
what to create and how to organize it. Paths are case-sensitive, NFC-normalized,
relative names; directories are implicit prefixes. This is a managed workspace
accessed through MCP, not a mounted filesystem or an arbitrary host-file API.

Every accepted mutation creates an immutable version. A write replaces content;
a move changes the path; trash removes the file from active listings; restore
appends a new active version containing a selected historical version's bytes.
Restoration can choose a different path and refuses occupied destinations.
Trash and earlier versions are retained without automatic cleanup. Removing a
plugin never removes these separately managed databases.

## Public contracts and collaboration

The context exposes `WorkspaceOperations` and `WorkspaceConnection` through its
[inbound ports](ports/inbound/index.ts). Public views are independent of domain
models. `createConnectWorkspace` uses its own `WorkspaceAccessGateway`; the
consumer-owned `infrastructure/acl/access/` adapter imports only Access's explicit
inbound index and translates its decisions. Dependencies are `Workspace -> Access`
and `Memory -> Access`; Memory and Workspace do not call each other or share
tables, types, transactions, migrations or operation IDs.

Read/write grants are checked before persistence. One connection binds one
logical individual, supplied by the operator's local launch configuration rather
than a tool argument. Every transaction checks the database's pinned owner.
Access's local-process adapter is used only by the private stdio composition;
it is not an HTTP credential verifier. Current remote deployments do not expose
Workspace or issue workspace permissions.

## Owned state and transaction rules

- `workspace_state`: pinned individual and monotonic change sequence.
- `file_revisions`: immutable metadata and bytes, keyed by file ID and version.
- `file_heads`: current version/path and trash state, with a unique active path.
- `workspace_operations`: retry fingerprints and the immutable result version.

A Workspace-owned Unit of Work acquires the SQLite writer with `BEGIN IMMEDIATE`
before reading current state. It commits the version, head, sequence and receipt
together. Stores never begin or commit transactions. Async callbacks, nesting and
escaped transaction capabilities are rejected. Exceptions roll the transaction
back; provider errors are translated without exposing SQL, paths or contents.
SQLite uses its rollback journal, full synchronous commits, foreign keys and a
five-second busy timeout. A lock timeout returns unavailable; retry the identical
operation. Different contexts commit separately.

Mutations require a stable operation ID and expected current version (zero for a
new file ID). A stale version fails; an identical completed retry returns its
original receipt even after subsequent writes. Reusing an operation ID with
different metadata or bytes fails. Content is copied before asynchronous digest
work. SHA-256 fingerprints are request identities, not authentication proofs.
File/directory path collisions are rejected as well as duplicate active paths.

Lists return metadata only, at a fixed sequence snapshot. Later moves, deletions
or writes do not change subsequent pages. History paginates backwards by immutable
version; read a listed version explicitly. Byte reads are bounded and must pin a
version across chunks. Binary transfers use canonical base64 at MCP delivery;
ports and domain use platform-independent bytes.

## Persistence and migrations

The SQLite adapter independently owns Postgrator do/undo SQL pairs under
`infrastructure/persistence/sqlite/migrations/`, with SHA-256 pins verified by
`migrations:check`. Published migration bytes/pins are immutable. Add a continuous
next pair for changes. `migrate:workspace status` opens read-only and never creates
schema; `up` locks before inspecting the ledger and applies pending SQL and the
ledger atomically. Local startup calls the same adapter and initializes a pinned
owner. It rejects unknown future versions, damaged ledgers, untracked schemas and
identity mismatches. No automatic downgrade, force, reset or repair is provided.
Forward recovery uses a reviewed next migration; reverting code is not a rollback
of persisted state. Undo files are validation artifacts, not CLI commands.

Each individual has `workspace.sqlite` separate from `memory.sqlite`. Storing
bounded file bytes in the same SQLite transaction as metadata avoids a second
filesystem commit or a reconciliation journal. The implementation uses Node's
built-in SQLite and the existing Postgrator dependency. The Worker dependency
graph excludes this adapter. No object store or Cloudflare resource is needed.

## Limits and non-responsibilities

Files are limited to 1 MiB decoded, reads to 64 KiB and metadata pages to 50 items.
Paths are at most 512 UTF-16 code units with 128-unit segments; nonportable names,
absolute paths, traversal and control characters are rejected. Large file uploads,
empty directories, recursive bulk changes, filesystem watching, shell execution,
full-text file search, quotas, permanent erasure and archive import/export are not
implemented. History increases disk usage; a full disk must fail the write rather
than remove retained versions. This is suited to notes and small attachments.

Workspace does not define personality, choose memories or summarize files into
Memory. Memory restoration neither blocks nor restores Workspace. Memory exports
contain no files. For a cold backup, stop every process using the individual and
copy its entire directory; live filesystem copying is unsupported. Version/trash
recovery is not protection from disk loss. Data belongs to the local OS user:
separate Ezer routing is not a sandbox against another process with the same OS
permissions. Use local disks, not network shares or cloud-sync folders.

## Validation and references

Node integration and packaged stdio tests cover persistence after restart, binary
round trips, history/trash restoration, cross-process conflicts, exact retries,
snapshot pages, permission/identity denial, path rejection, transaction rollback,
and migration corruption/recovery. Native Codex acceptance is an opt-in command;
deterministic tests do not establish native host behavior or cross-computer sync.

- [MCP stdio transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#stdio)
- [SQLite atomic transactions](https://sqlite.org/transactional.html)
- [SQLite BLOB storage tradeoffs](https://sqlite.org/fasterthanfs.html)
