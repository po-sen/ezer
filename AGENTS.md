# Ezer repository instructions

## Scope and working agreements

Ezer is an early-stage plugin project using Agent Skills and MCP. The planned
memory service uses TypeScript on Cloudflare Workers. Its public MCP endpoint
exposes service information. An internal SQLite-backed Durable Object implements
memory persistence; authentication and public memory tools are not implemented.
Keep product behavior portable across compatible host agents.
These instructions guide repository development, not Ezer's runtime personality.

- Write repository files, code comments, and PR descriptions in English.
  Use the user's preferred language in conversation.
- Before editing, identify the requested outcome, scope, and observable acceptance
  criteria. Resolve material ambiguity; do not repeat questions already answered.
  Work directly through PRs; no issue is required. Put the problem, intended
  behavior, and validation results in the PR description.
- Preserve unrelated work. Architecture drafts and the Python portability
  prototype are local-only until the user explicitly authorizes their inclusion.
  Stage explicit paths; do not use blanket staging commands.
- Never read, print, or commit credentials or private memory data. Use synthetic
  test inputs. Deployment and production data changes need explicit authorization.

## Repository map and commands

- `README.md`: project overview and developer setup.
- `scripts/`: development checks; local prototype scripts are not release code.
- `.husky/`: local pre-commit hook.
- `.github/`: CI and pull request template.
- `apps/ezer-memory/`: Worker entry point, memory context, and service tests.
- `pnpm-workspace.yaml`: workspace membership and dependency build permissions.
- `AGENTS.md`: canonical instructions; `CLAUDE.md` imports this file.

Use Node.js 24 (the CI version in `.node-version`) or later, and the exact pnpm
version pinned by `packageManager` in the root `package.json`:

| Command                          | Purpose                                                                                            |
| -------------------------------- | -------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile` | Install locked dependencies and activate local Git hooks.                                          |
| `pnpm run check`                 | Check indexed paths, then format-check tracked working-tree files. Stage intended new files first. |
| `pnpm run check:staged`          | Validate the staged snapshot before committing.                                                    |
| `pnpm run format <files>`        | Format explicitly selected files.                                                                  |

The full check does not include untracked drafts. It checks tracked working-tree
formatting, then runs service type checks, architecture and Worker tests, and a
local bundle build. Use the staged check to validate partially staged formatting.
Service commands are available with `pnpm --filter @ezer/memory run <command>`:
`types`, `types:check`, `typecheck`, `test`, `build`, `dev`,
`migrations:generate`, `migrations:check`, `migrate:sqlite`,
`migrate:postgresql`, and `test:postgresql`. The full check requires the dedicated
PostgreSQL test service described in the service README. Persistence tests
use synthetic data through the internal `EZER_MEMORY` binding. Keep that binding
off public HTTP/MCP routes until authentication and individual authorization exist.
Worker declarations are generated with `wrangler types`; commit the output after
configuration, export, or Wrangler changes. Never hand-edit or format
`apps/ezer-memory/worker-configuration.d.ts`. The full check rejects stale types
before type checking regenerates them. The build uses Wrangler's dry-run mode;
it does not deploy. Never claim that a local test proves remote installation or
cross-computer memory continuity.

Use one root `pnpm-lock.yaml`; do not add npm or Yarn lockfiles. Keep runtime
dependencies in the application that imports them and root dependencies limited
to repository tooling. Review dependency lifecycle scripts before updating
`allowBuilds`; do not enable all builds or hoist undeclared dependencies to make a
check pass. CI must install with the frozen lockfile.

Put deployable applications in `apps/` and plugin artifacts in `plugins/`. Add
shared `packages/` only for actual reuse, with explicit exports and `workspace:`
dependencies. Do not split DDD layers into workspace packages by default.

Put runtime and operational entrypoints in `src/entrypoints/`. Bootstrap contains
composition factories; Cloudflare lifecycle and RPC delegation stay in entrypoints.
For now, these directories must have equal TypeScript file counts and pair
one-to-one: each entrypoint imports exactly one bootstrap module, and each bootstrap
module belongs to exactly one entrypoint at the matching relative path. The Worker
HTTP handler and Durable Object class share `entrypoints/index.ts`; their composition
shares `bootstrap/index.ts`. Each migration CLI has its own subdirectory and index
in both trees. Never aggregate Node CLI entrypoints into the Worker entrypoint.
Keep the Node migration CLIs separate from the Worker dependency graph. Worker
and CLI have separate TypeScript configurations; use explicit `.ts` extensions
for repository source imports so Node can execute the CLI without a custom loader.
Keep build-time SQL packaging in `scripts/`.

Every source module directory has an `index.ts` that explicitly exposes its public
API. Cross-directory imports, type imports, and re-exports of repository TypeScript
must target `index.ts` with an explicit `.ts` extension. Within a directory, import
implementation files directly; never import the directory's own index back into
its implementations. External packages, platform modules, JSON metadata, and
official generated declarations retain their native import conventions. Tests and
development scripts obey the same import rule but need no barrel unless they expose
a reusable module. File-discovered migration resources do not need an index.

Indexes do not relax architecture boundaries: validate the original declaration
behind aliases, namespace imports, and re-exports. Module indexes contain explicit
re-exports, not wrappers hiding dependencies; runtime entrypoint/bootstrap indexes
retain their lifecycle/composition responsibilities. Context grouping indexes expose
public inbound contracts; the persistence grouping index exposes adapter namespaces
as types only. Runtime composition imports the selected adapter's index directly.
SQLite's portable Stores and Node-only `sqlite/cli/` have separate indexes so Worker
imports cannot pull in Node SQLite or migration packages.

Organize service code by bounded context under `src/modules/`, with `ports/inbound/`
and `ports/outbound/`. Keep domain models pure and place use
cases behind inbound ports; external effects belong behind outbound ports.
Delivery uses inbound ports, and bootstrap only composes implementations.
Commands, queries, and detached views belong to inbound ports; domain types must
not serve as wire contracts. A focused Unit of Work owns transaction demarcation;
Stores do not begin or commit transactions. Keep versioned SQL pairs under the
owning context's `infrastructure/persistence/<adapter>/migrations/`.
Keep `persistence/sqlite/` and `persistence/durable-object/` independent. Each owns
its SQL, session types, migration artifacts, and checksums. PostgreSQL owns a
third independent migration adapter; its memory Stores are not implemented.
Do not import or re-export a sibling infrastructure folder's implementation, types,
or migrations, including indirectly through an ancestor index. A folder can use its own files/children and ancestor contracts,
not sibling branches. Outside infrastructure, depend only on the context's
outbound ports; bootstrap selects and composes implementations. Do not bypass
these boundaries with parent re-export barrels or injected sibling implementations.
Durable Object owns its native transactions and migration ledger. SQLite must not
depend on Cloudflare types. Its standalone migration driver uses Node SQLite.
Shared port contracts do not imply shared SQL history;
do not synchronize migrations between adapters. SQL stays in its owning adapter.
Never embed handwritten DDL in TypeScript. Review SQL and checksum changes before regenerating the bundle.
Released migration files and pins are immutable. See the memory context README
for backend-specific lifecycle, file naming, and forward-only recovery.
SQLite uses Postgrator do/undo SQL pairs; PostgreSQL uses node-pg-migrate up/down
pairs and its native migration API. DO retains its original SQL format and ledger.
Operational CLIs expose only `status` and `up`; do not add implicit downgrade,
repair, force, or cross-context transactions. Status must not create schema.
PostgreSQL migrations run with an adapter-owned advisory lock; ordinary migrations
commit individually. SQLite locks before reading history and commits pending SQL
and its ledger together. Never print connection details, SQL, raw provider errors,
or private data from operational commands. Add layers when they have real responsibilities, not as empty scaffolding. Extend
architecture checks when introducing a new context or allowed dependency.

## TypeScript exports

Each repository-owned TypeScript module may expose at most one exported name.
Count functions, types, interfaces, classes, constants, default exports, and
re-exported names, including names exposed through `export *`. A single statement
such as `export { A, B }` still exports two names. Overloads of one exported name
count once. Zero exports are allowed. Private helpers and object/class members
do not count as module exports. Keep implementation-only types private; split
independently consumed exports into separate implementation modules.

Any `index.ts` may expose multiple names. `apps/ezer-memory/src/bootstrap/` and
`apps/ezer-memory/src/entrypoints/` also allow multiple exports, subject to their
one-to-one pairing rule. The official generated
`apps/ezer-memory/worker-configuration.d.ts` is also excluded. Other generated
TypeScript, including migration bundles, is not exempt. This rule applies to all
tracked TypeScript files, including tests, configuration, and root development
scripts. The repository-wide export test enforces these exact exceptions.

## GitHub account

Use the `po-sen` GitHub account for all GitHub CLI operations targeting
`po-sen/ezer`.

Before a batch of GitHub operations:

1. Record the current account with `gh api user --jq .login`.
2. If needed, run `gh auth switch --hostname github.com --user po-sen`.
3. Verify that `gh api user --jq .login` returns `po-sen` before proceeding.
4. Restore the previous account after the batch, including when an operation
   fails. Account switching affects the entire GitHub host, not just this repo.

Use the existing authenticated account. Do not extract tokens, inspect credential
files, or inject token values to select an account.

## Changes to main

Deliver each completed batch of repository changes through a pull request so the
user can review and track it. Do not stop at local, uncommitted changes unless the
user explicitly requests local-only work. Include the PR link in the handoff.

Use a `codex/` feature branch and a pull request for changes to `main`. Do not push
directly to `main` or attempt to bypass repository rules. Recheck the live rules
before publishing; the current rules require pull requests and squash merges.
Do not merge a PR unless the user explicitly requests the merge.

## Review and completion

1. Keep each PR focused on one coherent outcome. Avoid unrelated cleanup and
   speculative abstractions.
2. Review the final diff for correctness, scope, compatibility, and unintended
   files. Add regression coverage when a behavior change needs it; do not invent
   tests that merely mirror configuration or formatting changes.
3. Run relevant local checks, then use the PR template to report observed results,
   limitations, and reviewer attention areas. Keep its title and body current.
4. Open new PRs as drafts and assign the acting account. Mark them ready only after
   implementation, self-review, local validation, and required CI on the latest
   revision pass. Return to draft if further work invalidates readiness.
5. Report the PR link and verified check results. The maintainer reviews the final
   diff and decides whether to merge. AI review is supplementary, not approval or
   evidence that unrun checks passed.

`Repository checks` runs repository and service validation. Do not disable checks
or weaken repository rules to get a change merged. A ready PR is not permission
to merge or deploy.
