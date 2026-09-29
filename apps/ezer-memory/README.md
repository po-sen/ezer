# Ezer memory service

This package establishes the TypeScript and Cloudflare Workers execution path for
Ezer's independent memory service. It currently exposes service information only.
There is no persistent memory, authentication, model invocation, or cloud
deployment in this foundation.

## Development

From the repository root, use the pinned pnpm version and run
`pnpm install --frozen-lockfile`, then:

| Command                                | Purpose                                                   |
| -------------------------------------- | --------------------------------------------------------- |
| `pnpm --filter @ezer/memory dev`       | Start Wrangler locally on loopback.                       |
| `pnpm --filter @ezer/memory typecheck` | Check source, tests, and test configuration.              |
| `pnpm --filter @ezer/memory test`      | Check dependency boundaries and exercise MCP in workerd.  |
| `pnpm --filter @ezer/memory build`     | Produce a local bundle using `wrangler deploy --dry-run`. |
| `pnpm run check`                       | Run the repository's full CI validation.                  |

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

`bootstrap/worker-types.d.ts` merges the entry point's type into
`Cloudflare.GlobalProps.mainModule`. This lets TypeScript check calls such as
`exports.default.fetch()` from `cloudflare:workers` in the integration tests.
It is a hand-maintained declaration for the current entry point, emits no runtime
code, and contains no memory model or storage configuration.

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
