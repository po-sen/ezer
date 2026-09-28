# Ezer repository instructions

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
