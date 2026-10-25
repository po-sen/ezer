# Ezer plugin alpha

This directory is the shared source for Ezer instance packages. Package it before
installation; do not install this source directory or a local Python prototype.
An instance package includes the same skill, its own installation/server name,
one explicit local identity or remote memory endpoint, and native Codex and Claude Code manifests.

## Prerequisites

For **local mode**, the operator builds with Node.js 24.5+ and the repository's
pinned pnpm dependencies. The installed plugin requires Node.js 24.5+ on PATH;
its server and runtime dependencies are bundled. No account, OAuth, Cloudflare,
listening port or separate database server is needed. macOS and Linux are the
tested targets; Windows native installation has not been verified.

For **remote mode**, an operator must provide a reachable HTTPS `ezer-memory` endpoint ending in
`/mcp` and configure [Cloudflare Access login](../../apps/ezer-memory/AUTHORIZATION.md)
or an external OAuth authority, with caller-to-individual
assignment. See the [service README](../../apps/ezer-memory/README.md).
The plugin does not deploy a service, provision a login provider, or grant access.
The default service configuration denies connections.

The operator packages with Node.js 24.5 or later; installed remote plugins need no Node,
Python, pnpm, local database, or MCP proxy. Their host must support skills and
remote Streamable HTTP MCP with the deployment's OAuth flow.

## Package an instance

To keep a local Ezer on the machine running the agent:

```sh
pnpm plugin:package --name ezer-personal --local --individual personal --out dist/ezer-personal
```

Data defaults to `~/.ezer/individuals/<individual>/`. `--data-dir` selects a
canonical absolute private root outside the package, on the agent's machine.
The individual is a stable 1–64 character ID using ASCII letters, digits, `_`
and `-`, starting with a letter or digit. The plugin name is just a label.
Keep both the individual and root unchanged across upgrades. Do not put data in
a plugin cache, network share or cloud-sync folder. Restore permission defaults
off; add `--allow-restore` only for instances that should permit explicit memory
recovery into an empty database. It does not automatically start a restore.

The bundled stdio process is started and stopped by the host. Launch settings
are operator configuration, not agent-selectable tool arguments. Its two private
SQLite files retain memory and workspace independently. No host settings, hooks
or global instructions are added by the package.

For remote mode, replace the example URL with the operator's public
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

The packager reads an explicit allowlist of shared metadata, skill and references.
Local packages additionally contain `server/` with the Node bundle, source map,
dependency licenses and independently owned migration files, plus a Codex stdio
overlay. It never copies databases, node_modules, prototype files or arbitrary
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

Restart the host session and explicitly select the installed skill. Remote
instances also authenticate the MCP connection through the host's native OAuth flow. In Codex,
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
endpoint (or local individual and data root), then use the host's marketplace/remove/install controls to replace
the old registration. Do not repoint a live name to a different Ezer silently.
Removing a plugin does not delete its separately stored memory or workspace.

## Several independent Ezers

Package again with a distinct name, such as `ezer-work`, and that individual's
endpoint, or `--local --individual work`. Each package has distinct marketplace, plugin, skill, and MCP server
names. The skill binds to its packaged server rather than matching a tool suffix.
Different names alone do not isolate memory: two connections authorized to the
same individual in the same backend share its records. Isolation is enforced
by the backend's authorized assignment.

Two agents on one computer can share the same local individual/data root, including
across projects. Concurrent changes require matching current versions; conflicting
writes fail instead of silently overwriting one another. For another computer to
continue the same Ezer through remote mode, install the same package and
authenticate a caller assigned to the same individual in the same deployment.
Do not infer identity equivalence from labels or an ID returned by another
deployment. Keep different individuals in separate conversations where possible;
skills cannot enforce isolation inside a model's shared context.

## Local file workspace

The local server adds `ezer_workspace_info` and `ezer_file_write`, `ezer_file_read`,
`ezer_file_list`, `ezer_file_history`, `ezer_file_move`, `ezer_file_trash`, and
`ezer_file_restore`. The agent chooses its directory organization and content.
Paths are logical MCP names, not mounted host paths. Files support UTF-8 text or
base64 binary attachments up to 1 MiB; reads are bounded to 64 KiB. Versions and
trash are retained with no automatic purge. Restoring creates a new version.
See the [workspace instructions](skills/ezer/references/workspace.md).

Memory exports/restores contain no workspace files. For a cold backup, stop all
processes using the individual and copy its entire directory; live copying is
unsupported. Old versions consume disk, and history is not a backup against disk
loss. This is same-OS-user storage, not a sandbox against other processes owned
by that user. Local installation on another computer creates independent data;
it does not synchronize it.

## Behavior and acceptance

On activation, the skill confirms identity, lists bounded memory previews with
the most recent changes first when `memoryRecent` is advertised, and reads relevant
complete revisions. Recent means created or corrected by change sequence, not
importance or trustworthiness. Older servers retain default listing with an
explicit recovery limit. During interaction the agent chooses what
to preserve, links evidence, and reconciles corrections. It has no fixed
personality schema or reserved memory IDs. Listing preserves the selected order
in its cursor; literal body search remains oldest first. Both preserve the first
page's snapshot. The agent chooses search phrases and reads complete
matching revisions; search is not semantic, and an empty result does not establish
that the Ezer has no memories. The skill falls back to bounded listing when an
older server does not advertise `memorySearch`.

On an explicit export request, the skill uses `ezer_export` when `memoryExport`
is advertised. It preserves versioned JSON pages of complete revision history,
including superseded content and sources, through the final cursor. It checks
identity and snapshot continuity and reports partial output honestly. Export
requires read permission; the user chooses its destination. See the packaged
[export instructions](skills/ezer/references/exporting-memories.md).

Installation makes the skill available. It does not guarantee activation in
every conversation, background reflection, consciousness, or identical behavior
across models. Explicit activation is the alpha acceptance path. The plugin
does not add hooks or alter the host's global instructions.

After local installation, or remote deployment and login setup, verify with synthetic information:

1. In host A, activate the skill and confirm the intended identity. State a
   preference and verify a sourced write receipt.
2. In a fresh conversation in host B, activate the same instance. Verify that it
   lists and reads that memory before referring to the preference.
3. Correct an older memory in B. Verify a new revision and that it appears first
   in A's fresh recovery when `memoryRecent` is available. Continue an earlier
   cursor and verify that it still returns its original snapshot and order;
   a prior receipt or cursor is not proof of current contents.
4. Activate a different instance. Verify that it cannot retrieve A's record and
   does not substitute A's tools when its own connection is unavailable.
5. Search for a concrete phrase after the relevant memory is beyond the first
   listing pages. Verify that the agent reads the matching revision, distinguishes
   no match from no memories, and starts a new search after a correction.
6. Test missing read/write grants, partial pagination, an unavailable service,
   and concurrent corrections. Verify honest limits rather than invented recall
   or duplicate writes.

These are host/model acceptance checks, not guarantees from static validation.
The repository's [local acceptance runner](../../apps/ezer-memory/ACCEPTANCE.md)
exercises generated packages with isolated synthetic services, and can run real
Codex/Claude Code sessions separately from CI.
Local package and backend tests do not establish remote login or cross-computer
continuity. Physical deletion, cross-identity import, verified production disaster-recovery backup and semantic search are not
provided. Attachments are available only through the bounded local Workspace.

## Packaging rationale

The portable package uses [Agent Plugins 1.0](https://agent-plugins.org/).
Native overlays and marketplaces follow the
[Codex supported formats](https://learn.chatgpt.com/docs/enterprise/plugin-management#supported-formats),
[Claude manifest reference](https://code.claude.com/docs/en/plugins-reference),
and [Claude marketplace reference](https://code.claude.com/docs/en/plugins/marketplace-reference).
OpenAI does not expand Claude's
[`userConfig` installation variables](https://developers.openai.com/plugins/guides/submit-claude-plugin#replace-claude-userconfig).
Generating ordinary manifests from non-secret instance settings keeps one skill
implementation and preserves native HTTP/OAuth or stdio. The local manifests use
the documented [Codex `${PLUGIN_ROOT}`](https://developers.openai.com/plugins/deploy/desktop-only)
and Claude `${CLAUDE_PLUGIN_ROOT}` path expansion, with persistent data outside
installation directories. No host-specific proxy or custom secret format is used.

This is a repository-distributed alpha, not an OpenAI or Anthropic public-directory
submission. Publishing a listing and verifying real-provider compatibility are
separate release work.

The packaged restore reference uses `ezer_restore` only on an explicit recovery
request. It validates the full archive before writing, uses one stable restore
ID, resumes identical pages after interruption, and verifies by exporting the
restored snapshot. The same logical identity, empty target, and separate restore
permission are required. Incomplete restoration blocks normal memory access
until resumed; there is no cancel or overwrite operation.

On servers advertising `memoryRestoreStatus`, `ezer_restore_status` reports
restore metadata using the same independent grant. A fresh conversation can find
the original ID and progress; a status-only request never resumes automatically.
Explicit resume requires the original full archive and replays its pages to
verify the accepted prefix before continuing. Null status does not mean empty
memory. Older servers require the original ID retained outside the conversation.
