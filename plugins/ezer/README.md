# Ezer plugin alpha

This directory is the shared source for Ezer instance packages. Package it before
installation; do not install this source directory or a local Python prototype.
An instance package includes the same skill, its own installation/server name,
one explicit memory endpoint, and native Codex and Claude Code manifests.

## Prerequisites

An operator must provide a reachable HTTPS `ezer-memory` endpoint ending in
`/mcp` and configure its external OAuth authority and caller-to-individual
assignment. See the [service README](../../apps/ezer-memory/README.md).
The plugin does not deploy a service, provision a login provider, or grant access.
The default service configuration denies connections.

The operator packages with Node.js 24 or later; installed plugins need no Node,
Python, pnpm, local database, or MCP proxy. Their host must support skills and
remote Streamable HTTP MCP with the deployment's OAuth flow.

## Package an instance

From this repository, replace the example URL with the operator's public
resource URL, never a login URL, token, or URL containing credentials:

```sh
pnpm plugin:package \
  --name ezer-personal \
  --url https://memory.example.com/mcp \
  --out dist/ezer-personal
```

Names start with `ezer-` and use lowercase alphanumeric words separated by single
hyphens, up to 50 characters total. Use a canonical HTTPS URL with path `/mcp`;
queries, fragments, user information, and implicit URL normalization are rejected.
The command does not contact or verify that endpoint. Output must be a new
directory; neither it nor its ancestors may be symlinks.

The result contains:

```text
ezer-personal/
  README.md
  .agents/plugins/marketplace.json
  .claude-plugin/marketplace.json
  plugins/ezer-personal/
    plugin.json
    mcp.json
    .codex-plugin/plugin.json
    .claude-plugin/plugin.json
    .mcp.json
    skills/ezer-personal/
      SKILL.md
      references/connection.md
      references/writing-memories.md
```

The packager reads only the shared manifest, skill, and writing reference. It
generates connection metadata and both marketplace formats without copying other
worktree files. No secret inputs are supported. Keep generated packages out of
Git; the public endpoint may still reveal deployment names.

## Install on the agent's computer

Copy the entire generated directory, including hidden files, to the computer
running the host agent. A path on a developer's machine is not accessible to a
remote host automatically. Register that copied directory using the appropriate
host's commands.

Codex:

```sh
codex plugin marketplace add /absolute/path/to/ezer-personal
codex plugin add ezer-personal@ezer-personal-local
```

Claude Code:

```sh
claude plugin marketplace add /absolute/path/to/ezer-personal
claude plugin install ezer-personal@ezer-personal-local
```

Restart the host session, authenticate the instance's MCP connection using the
host's native OAuth flow, and explicitly select the installed skill. In Codex,
mention `ezer-personal` using the skill picker; in Claude Code, use
`/ezer-personal:ezer-personal`. A first prompt can be:

> Continue this Ezer, confirm its identity, and recover useful memories before
> we start.

Credentials belong to the host's credential management. Never put them in a
manifest, skill, generated directory, source-control file, memory, or chat.
The deployment needs connection, memory-read, and memory-write grants for the
full workflow; having connection permission alone is insufficient.

Keep the generated marketplace directory available for host refreshes. To
upgrade, package the new source into a new directory using the same name and
endpoint, then use the host's marketplace/remove/install controls to replace
the old registration. Do not repoint a live name to a different Ezer silently.
Removing a plugin does not delete the server's memory.

## Several independent Ezers

Package again with a distinct name, such as `ezer-work`, and that individual's
endpoint. Each package has distinct marketplace, plugin, skill, and MCP server
names. The skill binds to its packaged server rather than matching a tool suffix.
Different names alone do not isolate memory: two connections authorized to the
same individual in the same backend share its records. Isolation is enforced
by the backend's authorized assignment.

For another computer to continue the same Ezer, install the same package and
authenticate a caller assigned to the same individual in the same deployment.
Do not infer identity equivalence from labels or an ID returned by another
deployment. Keep different individuals in separate conversations where possible;
skills cannot enforce isolation inside a model's shared context.

## Behavior and acceptance

On activation, the skill confirms identity, lists bounded memory previews, and
reads relevant complete revisions. During interaction the agent chooses what
to preserve, links evidence, and reconciles corrections. It has no fixed
personality schema or reserved memory IDs. Listing is paginated, ordered by
change sequence ascending, and is not semantic search.

Installation makes the skill available. It does not guarantee activation in
every conversation, background reflection, consciousness, or identical behavior
across models. Explicit activation is the alpha acceptance path. The plugin
does not add hooks or alter the host's global instructions.

After deploying and configuring real login, verify with synthetic information:

1. In host A, activate the skill and confirm the intended identity. State a
   preference and verify a sourced write receipt.
2. In a fresh conversation in host B, activate the same instance. Verify that it
   lists and reads that memory before referring to the preference.
3. Correct it in B. Verify a new revision and that A can read it in a fresh
   recovery; a prior receipt or cursor is not proof of current contents.
4. Activate a different instance. Verify that it cannot retrieve A's record and
   does not substitute A's tools when its own connection is unavailable.
5. Test missing read/write grants, partial pagination, an unavailable service,
   and concurrent corrections. Verify honest limits rather than invented recall
   or duplicate writes.

These are host/model acceptance checks, not guarantees from static validation.
Local package and backend tests do not establish remote login or cross-computer
continuity. Physical deletion, backup/restore, search, and attachments are not
provided by this plugin.

## Packaging rationale

The portable package uses [Agent Plugins 1.0](https://agent-plugins.org/).
Native overlays and marketplaces follow the
[Codex supported formats](https://learn.chatgpt.com/docs/enterprise/plugin-management#supported-formats),
[Claude manifest reference](https://code.claude.com/docs/en/plugins-reference),
and [Claude marketplace reference](https://code.claude.com/docs/en/plugins/marketplace-reference).
OpenAI does not expand Claude's
[`userConfig` installation variables](https://developers.openai.com/plugins/guides/submit-claude-plugin#replace-claude-userconfig).
Generating ordinary manifests from non-secret instance settings keeps one skill
implementation and preserves native HTTP/OAuth, without a host-specific proxy.

This is a repository-distributed alpha, not an OpenAI or Anthropic public-directory
submission. Publishing a listing and verifying real-provider compatibility are
separate release work.
