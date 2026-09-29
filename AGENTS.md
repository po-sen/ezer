# Ezer repository instructions

## Scope and working agreements

Ezer is an early-stage plugin project using Agent Skills and MCP. The planned
memory service uses TypeScript on Cloudflare Workers. Its current foundation
exposes service information; persistence and authentication are not implemented.
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
`typecheck`, `test`, `build`, and `dev`. The build uses Wrangler's dry-run mode;
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

Organize service code by bounded context. Keep domain models pure and place use
cases behind inbound ports; external effects belong behind outbound ports.
Delivery uses inbound ports, and bootstrap only composes implementations. Add
layers when they have real responsibilities, not as empty scaffolding. Extend
architecture checks when introducing a new context or allowed dependency.

## TypeScript public functions

Each repository-owned TypeScript module may expose at most one public function.
Public means a callable runtime export, including named/default functions,
function-valued variables, and re-exported functions. Count exported names, not
overload signatures. Keep additional helpers private to the module or move
independent public functions into separate files.

Unexported helpers, nested callbacks, type-only exports, and interface method
signatures do not count. Files containing only types, configuration, or a Worker
handler object may have no exported function. This convention concerns module
exports, not methods belonging to an object or class. Apply it to application
code, tests, and development scripts, and check it during diff review.

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
