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
repository includes its initial MCP service foundation and development tooling.
Memory persistence and authentication are not implemented yet. Installing the
plugin will not require these development dependencies.

Use Node.js 24 or later and npm. From a Git checkout, install the locked
development dependencies and activate the local Git hooks:

```sh
npm ci
```

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
npm run format -- README.md
git add -- README.md
npm run check:staged
```

Use `npm run format:check -- <files>` to check explicit files without modifying
them. Hook checks run locally without calling a model or a remote service.
The service has strict TypeScript checks, architecture checks, and MCP integration
tests that run in the local Workers runtime.

### Continuous integration

Run the same full check as CI with:

```sh
npm run check
```

This checks all indexed paths before formatting supported tracked files, even
when no changes are staged. It reads working-tree contents and excludes untracked
drafts. Stage intended new files before running it; use `check:staged` to validate
a partially staged commit. Neither command reformats files. The full check also
runs service type checks, tests, and a local Worker bundle build.

GitHub Actions runs `Repository checks` on Node.js 24 for every PR targeting
`main`, including drafts and documentation changes, and for pushes to `main`.
It installs from the lockfile, uses read-only repository permissions, and does
not require project secrets. The `main` ruleset must require this check; workflow
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

The [`ezer-memory` service](services/ezer-memory/README.md) exposes `/health` and
an HTTP MCP endpoint at `/mcp`. Its only tool is `ezer_service_info`, which reports
the current foundation's capabilities without reading or writing memory.

```sh
npm run dev --workspace @ezer/memory
```

The server listens on the development machine's loopback interface. It is not a
shared remote memory service. See the service README for checks and current
limitations.
