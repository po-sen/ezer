# Ezer repository instructions

## Scope and working agreements

Ezer is an early-stage plugin project using Agent Skills and MCP. The planned
memory service uses TypeScript on Cloudflare Workers; no production service is
implemented yet. Keep product behavior portable across compatible host agents.
These instructions guide repository development, not Ezer's runtime personality.

- Write repository files, code comments, issues, and PR descriptions in English.
  Use the user's preferred language in conversation.
- Before editing, identify the requested outcome, scope, and observable acceptance
  criteria. Resolve material ambiguity; do not repeat questions already answered.
  The development task issue form is optional for small, clear changes.
- Preserve unrelated work. Architecture drafts and the Python portability
  prototype are local-only until the user explicitly authorizes their inclusion.
  Stage explicit paths; do not use blanket staging commands.
- Never read, print, or commit credentials or private memory data. Use synthetic
  test inputs. Deployment and production data changes need explicit authorization.

## Repository map and commands

- `README.md`: project overview and developer setup.
- `scripts/`: development checks; local prototype scripts are not release code.
- `.husky/`: local pre-commit hook.
- `.github/`: CI, task form, and pull request template.
- `AGENTS.md`: canonical instructions; `CLAUDE.md` imports this file.

Use Node.js 24 (the CI version in `.node-version`) or later, and npm:

| Command                     | Purpose                                                                                            |
| --------------------------- | -------------------------------------------------------------------------------------------------- |
| `npm ci`                    | Install locked dependencies and activate local Git hooks.                                          |
| `npm run check`             | Check indexed paths, then format-check tracked working-tree files. Stage intended new files first. |
| `npm run check:staged`      | Validate the staged snapshot before committing.                                                    |
| `npm run format -- <files>` | Format explicitly selected files.                                                                  |

The full check does not include untracked drafts. It reads working-tree contents,
so use the staged check to validate partially staged commits. No build, service
type-check, or service test command exists yet; do not claim those checks passed.
Add relevant commands when their implementation is introduced.

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

`Repository checks` is the CI check for this tooling stage. Do not disable checks
or weaken repository rules to get a change merged. A ready PR is not permission
to merge or deploy.
