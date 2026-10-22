# Local acceptance

These checks exercise the built TypeScript Worker and generated plugin packages.
They do not use the local Python prototype, Cloudflare resources, real memories,
or deployment credentials.

## Deterministic transport and persistence check

```sh
pnpm --filter @ezer/memory test:e2e
```

This builds the Worker, packages independent instances, reads their generated MCP
configuration, and connects real MCP SDK clients over loopback HTTPS. It verifies
sourced writes, recovery in a new session after a runtime restart, correction,
historical reads, independent individuals, denied read access, and legacy MCP
streaming with client cancellation. It runs as part
of `pnpm run check` and CI without invoking a model.

Use Node.js 24.5 or later and OpenSSL with `req -addext` support. The runner targets
macOS and Linux. Each run owns a new temporary directory, random loopback ports,
and its own Miniflare persistence. TLS verification stays enabled: the test adds
its generated self-signed server certificate to the process trust list and restores
that list afterward. The certificate is a non-CA leaf with a loopback IP subject
alternative name. The HTTPS regression check validates both properties. Private
TLS and JWT keys stay in memory. The fixture removes its
clients, listeners, runtime, generated packages, public certificate, and synthetic
database when it finishes or fails.

## Native host checks

```sh
pnpm --filter @ezer/memory test:hosts
pnpm --filter @ezer/memory test:hosts --host codex
pnpm --filter @ezer/memory test:hosts --host claude
```

These optional checks require installed, authenticated Codex/Claude Code CLIs and
invoke their real models using the host's existing account. They can consume model
usage. They are excluded from CI. The runner never reads or copies login files or
asks for credential values.

Codex registers and installs uniquely named test marketplaces through its native
CLI, then removes those plugins and marketplace registrations. Claude Code loads
the generated plugin directories for the test sessions. Each model invocation is
a fresh, nonpersistent conversation in a new task-owned directory. Two instances
are installed or loaded so the selected skill must use its own server. Codex
uses its existing native configuration with hooks disabled and a read-only shell.
Its child process receives the fixture public trust bundle through
`CODEX_CA_CERTIFICATE`, which takes precedence over `SSL_CERT_FILE`; neither the
host trust store nor the user configuration is changed for certificate trust.
Claude uses restricted mode, explicit plugin read directories, and allowlisted
fixture tools. No permission bypass is used. Host settings and managed policy can
still affect availability; these are acceptance checks on that host, not a clean-room
claim about every installation.

The scenarios are learning, recall after runtime restart, correction, recall of
the corrected fact, and absence of that fact in the other individual. Recall
prompts deliberately omit the expected value. Evidence includes observed MCP
calls, the model's answer, and backend results; saying a write succeeded is not
sufficient. Each invocation has a two-minute timeout. The command reports bounded
JSON status records and exits nonzero on a failed or blocked scenario. It does not
save raw model transcripts or provider diagnostics.

The loopback gateway assigns a synthetic caller and signs its fixture credential.
The actual Worker still validates the signature, grants, and identity through its
normal Access and Memory code. This tests plugin use after authentication, not
the native OAuth browser login flow. The gateway is test-only, accepts only `/mcp`,
and never listens on a public interface. It must not be deployed or used for real
memory. Worker outbound requests are limited to the fixture's public JWKS.

## Observed results (2026-10-23)

| Layer                  | Version                        | Result                                                                                                    |
| ---------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Built Worker / MCP SDK | Locked repository dependencies | Passed the full 167-test repository check, including HTTPS persistence and streaming.                     |
| Codex                  | 0.163.0 on macOS               | Passed all five native scenarios with two installed instances and fresh model sessions.                   |
| Claude Code            | Not rerun                      | Skipped at the maintainer's request because paid access is unavailable. Compatibility remains unverified. |

`pnpm --filter @ezer/memory test:hosts --host codex` exited successfully with
`notRun: 0`. It observed these native calls and independently checked stored data:

| Scenario                                  | Evidence                                                                                                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Learn                                     | `ezer_service_info`, `ezer_identity`, and `ezer_remember`; revision 1 contains the synthetic preference and source.                                           |
| Fresh-session recall after Worker restart | `ezer_list` and `ezer_read`; the answer contains the saved value omitted from the prompt.                                                                     |
| Correction                                | `ezer_read` and `ezer_revise`; revision 2 contains the new preference and a reason, while revision 1 remains readable.                                        |
| Corrected recall                          | `ezer_list` and `ezer_read`; a fresh conversation returns the corrected value omitted from the prompt.                                                        |
| Other individual                          | The second instance's `ezer_identity` and `ezer_list`; no stored preference is claimed, its listing is empty, and it cannot read the first instance's record. |

### Resolved Codex fixture failure

The earlier run on 2026-10-22 installed the plugins and loaded their skills but
made no fixture MCP calls. A native `mcpServerStatus/list` probe subsequently
located the failure at the HTTPS handshake, before tool discovery. The loopback
server recorded `ERR_SSL_SSL/TLS_ALERT_CERTIFICATE_UNKNOWN`.

The fixture had marked its HTTPS endpoint certificate `CA:TRUE`. With the same
Codex version and explicit fixture trust bundle, changing it to `CA:FALSE`
allowed native discovery of all seven Ezer tools. The five model-driven scenarios
then passed using the installed packages. This was a test-certificate defect;
production Worker code and plugin manifests did not change. The regression check
prevents a CA certificate from being served as the endpoint leaf again.

Claude Code's last attempt on 2026-10-22 was blocked by its organization's
subscription-access policy. It was deliberately not retried in this run; no login,
billing, or organization settings were changed.

Temporary native plugin removals were confirmed by the runner. Task marketplaces,
fixture directories, listeners, and the disposable PostgreSQL check container were
removed. Native Codex success applies to this local synthetic setup; it does not
establish native OAuth login or remote continuity.

## Interpreting results

An SDK check passing establishes transport and persistence behavior. A native host
passing additionally establishes the observed installed version's skill/tool
behavior for these synthetic scenarios. Neither proves cross-computer access,
Cloudflare Access login, production performance, background activation, or behavior
across every model. Those remain separate acceptance checks after deployment.

An organization/account denial is a blocked native check, not a memory failure or
a pass. Resolve access outside this runner and rerun the affected host. Do not
disable authentication, substitute the SDK result for a host result, or supply
credentials in a package or report.

References: [Codex local plugins](https://developers.openai.com/plugins/build/plugins),
[Codex configuration](https://learn.chatgpt.com/docs/config-file/config-reference),
[Codex certificate trust](https://learn.chatgpt.com/docs/config-file/environment-variables#authentication-and-network),
[Claude CLI session plugins and restricted mode](https://code.claude.com/docs/en/cli-reference),
and [Node's process-local CA configuration](https://nodejs.org/api/tls.html#tlssetdefaultcacertificatescerts).
