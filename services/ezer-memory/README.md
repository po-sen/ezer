# Ezer memory service

This package establishes the TypeScript and Cloudflare Workers execution path for
Ezer's independent memory service. It currently exposes service information only.
There is no persistent memory, authentication, model invocation, or cloud
deployment in this foundation.

## Development

From the repository root, run `npm ci`, then:

| Command                                      | Purpose                                                   |
| -------------------------------------------- | --------------------------------------------------------- |
| `npm run dev --workspace @ezer/memory`       | Start Wrangler locally on loopback.                       |
| `npm run typecheck --workspace @ezer/memory` | Check source, tests, and test configuration.              |
| `npm test --workspace @ezer/memory`          | Check dependency boundaries and exercise MCP in workerd.  |
| `npm run build --workspace @ezer/memory`     | Produce a local bundle using `wrangler deploy --dry-run`. |
| `npm run check`                              | Run the repository's full CI validation.                  |

No Cloudflare login or project secrets are needed for these checks. The local URL
belongs to the machine running Wrangler. It does not prove connectivity from a
different computer. Public workers.dev and preview URLs are disabled in the
configuration; a real deployment requires a separate, authorized setup.

## Interfaces

- `GET /health` returns liveness, not memory-store readiness.
- `/mcp` serves Streamable HTTP using the official MCP SDK. Modern requests and
  legacy stateless clients use the same tool registration. Request bodies are
  limited to 64 KiB; browser requests with a foreign Origin are rejected.
- `ezer_service_info` takes no arguments and reports the service version, its
  `foundation` stage, and disabled memory read/write capabilities.

This endpoint only returns public service metadata. Before adding private memory
operations, implement authentication, principal-to-memory authorization, and
persistence together. Protocol sessions must never determine durable identity.
The current tests use synthetic MCP clients; native plugin installation and real
Codex/Claude Code compatibility still require separate acceptance tests.

## Code ownership

`src/memory/` is the initial bounded context. `inboundport/` defines its use-case
surface, `application/` implements it, and `delivery/` adapts HTTP and MCP. The
entry point delegates to `bootstrap/`, which wires these pieces together.

Add `domain/` when memory entities, value objects, and invariants are introduced.
Add focused `outboundport/` capabilities and `infrastructure/` implementations
when persistence or other external effects are needed. Do not create empty
layers, generic repositories, or shared business types to fill a diagram.

Inner layers must not import Cloudflare, MCP, HTTP, storage clients, environment
configuration, or another context. Domain rules receive time and identity as
values. Application code coordinates domain behavior through ports; delivery
validates wire input and translates use-case results. Bootstrap owns composition,
not business policy. The architecture tests enforce the current import allowlist;
runtime coupling still needs review.

## Next capabilities

SQLite-backed Durable Objects are the first persistence candidate to evaluate for
one Ezer's transactional state. R2 is a later attachment candidate. Neither is
bound or provisioned here. Storage, OAuth provider selection, migrations, data
recovery, and multi-computer continuity remain separate implementation steps.
