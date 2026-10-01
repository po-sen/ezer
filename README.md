# Ezer

Ezer is a plugin project built around Agent Skills and the Model Context Protocol
(MCP). It aims to preserve an assistant's identity and memories across agents and
computers.

The host agent provides reasoning, while an independent memory service stores
experiences. The agent decides what to remember and how to organize its memories
through use.

The project is in early development. A release for installation and deployment
is not yet available.

## Development

The memory service uses TypeScript and targets Cloudflare Workers. The
repository includes a SQLite-backed Durable Object memory core, OAuth access-token
validation, and scoped MCP tools for sourced memories, corrections, reading, and
pagination. An end-user login deployment and installable plugin release are not
implemented yet. Installing the plugin will not require
these development dependencies.

Use Node.js 24 or later and pnpm 12.6.0, pinned in the root `packageManager`
field. Install that pnpm version using the [official installation guide](https://pnpm.io/installation).
From a Git checkout, install the locked development dependencies and activate the
local Git hooks:

```sh
pnpm install --frozen-lockfile
```

The root `pnpm-workspace.yaml` defines workspace membership and dependency build
permissions. Only the reviewed esbuild and workerd versions may run dependency
installation scripts; optional fsevents builds are disabled. Review permission
changes when upgrading dependencies. Commands fail on an unexpected pnpm version
or stale dependencies instead of silently changing the development environment.
Dependency versions must be published for at least 24 hours before installation;
updates must satisfy this policy as well as the existing tests.

Keep one root `pnpm-lock.yaml`. After intentionally changing dependencies, run
`pnpm install`, review its lockfile changes, and commit them with the manifests.
To migrate an existing npm checkout, remove its generated `node_modules` before
the first pnpm install. Do not retain or regenerate `package-lock.json`.

### Repository layout

`apps/` contains independently deployable applications, starting with
`apps/ezer-memory/`. Each application owns its dependencies, configuration, tests,
and domain boundaries. The root owns shared development commands and Git hooks.

`plugins/` is reserved for installable plugin content; the current drafts remain
local-only. Skills and MCP configuration do not need a JavaScript workspace
unless they acquire a build step. Add `packages/` only when reusable code has an
actual consumer, declare cross-package dependencies with `workspace:`, and import
them through explicit package exports. DDD layers stay inside their owning
application rather than becoming separate workspace packages.

### Local checks

Before each commit, Husky runs a path guard followed by lint-staged and Prettier.
The guard checks indexed filenames and filesystem metadata without reading file
contents. It rejects environment files, common key-file extensions, local
databases, dependency/build directories, experiment data, and symbolic links.
This is a filename guard, not a scan for secrets embedded in source code.

Prettier checks staged TypeScript, JavaScript, JSON, Markdown, and YAML files.
Formatting errors block the commit; the hook does not automatically fix them.
lint-staged temporarily hides unstaged portions of partially staged files and
restores them afterward. Untracked design documents and prototypes are not
included in these checks or automatically staged.

Format an explicit file, review the changes, and stage the intended result:

```sh
pnpm run format README.md
git add -- README.md
pnpm run check:staged
```

Use `pnpm run format:check <files>` to check explicit files without modifying
them. Hook checks run locally without calling a model or a remote service.
The service has strict TypeScript checks, architecture checks, and MCP integration
tests that run in the local Workers runtime, Node SQLite CLI tests, and a disposable
PostgreSQL integration suite.

### Continuous integration

Run the same full check as CI with:

```sh
pnpm run check
```

This checks all indexed paths before formatting supported tracked files, even
when no changes are staged. It reads working-tree contents and excludes untracked
drafts. Stage intended new files before running it; use `check:staged` to validate
a partially staged commit. Neither command reformats files. The full check also
runs service type checks, tests, and a local Worker bundle build. It requires the
dedicated PostgreSQL test service described in the service README.

GitHub Actions runs `Repository checks` on Node.js 24 for every PR targeting
`main`, including drafts and documentation changes, and for pushes to `main`.
It installs with `pnpm install --frozen-lockfile`, uses read-only repository permissions, and does
not require project secrets. It provisions an isolated PostgreSQL test service. The `main` ruleset must require this check; workflow
files alone do not enforce merge protection.

### Working with agents

Read [AGENTS.md](AGENTS.md) for repository instructions, available commands, and
completion criteria. It is the shared source for compatible agents; the small
[CLAUDE.md](CLAUDE.md) entry point imports it for Claude Code. Confirm that your
host loads these instructions before starting work, especially when using custom
instruction settings. These files govern development, not the installed plugin's
runtime behavior.

Work directly through pull requests; no issue is required. Use the PR template
to explain the problem, intended behavior, and actual validation results. Keep
each PR focused and leave the final review and merge decision to the maintainer.
Instructions and local hooks supplement CI; they do not enforce permissions or
replace review.

### Memory service development

The [`ezer-memory` service](apps/ezer-memory/README.md) exposes `/health` and
an authenticated HTTP MCP endpoint at `/mcp`. `ezer_service_info` reports the
foundation's capabilities, and `ezer_identity` reports the authorized Ezer's stable
ID and current memory change sequence. `/health` remains public. The default empty
authorization policy disables MCP access until a deployment operator configures an
external OAuth authority and subject-to-Ezer bindings; see the service README.

The internal `EZER_MEMORY` binding supports sourced text memories, immutable
revisions, atomic writes, and idempotent retries in isolated Durable Objects.
Local tests cover concurrent corrections, rollback, recovery after object
eviction, token validation, and authorized routing to isolated memory objects.
MCP identity lookup reads only the bound object's change sequence. `ezer_remember`,
`ezer_read`, `ezer_revise`, and `ezer_list` expose scoped memory operations. Connection
permission alone cannot read or write contents; all tools route through the same
authorized identity. Pagination lists bounded previews at a stable sequence, and
reading a listed revision retrieves its complete content and source.

```sh
pnpm --filter @ezer/memory dev
```

The server listens on the development machine's loopback interface. It is not a
shared remote memory service. See the service README for checks and current
limitations.
