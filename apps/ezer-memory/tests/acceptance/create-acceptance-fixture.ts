import { spawnSync } from "node:child_process";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { getCACertificates, setDefaultCACertificates } from "node:tls";
import { fileURLToPath } from "node:url";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import {
  convertV4MiniflareOptions,
  Log,
  LogLevel,
  Miniflare,
  Response as MiniflareResponse,
} from "miniflare";

// This fixture never loads deployment configuration, credentials, or real memory.
export async function createAcceptanceFixture() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "ezer-acceptance-"));
  const originalCAs = getCACertificates("default");
  const servers: Server[] = [];
  const clients: Client[] = [];
  const calls: {
    instance: string;
    tool: string;
    arguments: Record<string, unknown>;
  }[] = [];
  let runtime: Miniflare | undefined;
  async function close() {
    await Promise.allSettled(clients.map((client) => client.close()));
    const listenerCleanup = await Promise.allSettled(
      servers.map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.closeAllConnections();
            server.close((error) =>
              error
                ? reject(new Error("Acceptance listener cleanup failed"))
                : resolve(),
            );
          }),
      ),
    );
    try {
      await runtime?.dispose();
    } finally {
      setDefaultCACertificates(originalCAs);
      rmSync(root, { recursive: true, force: true });
    }
    if (listenerCleanup.some((result) => result.status === "rejected"))
      throw new Error("Acceptance listener cleanup failed");
  }
  try {
    // Synthetic TLS and JWT private keys remain in memory for this run only.
    const tlsPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const key = tlsPair.privateKey.export({ type: "pkcs8", format: "pem" });
    // Linux cannot reopen Node's socket-backed stdin as a key file; use a pipe.
    const certificate = spawnSync(
      "sh",
      [
        "-c",
        'cat | openssl req "$@"',
        "ezer-acceptance",
        "-new",
        "-x509",
        "-key",
        "/dev/stdin",
        "-sha256",
        "-days",
        "1",
        "-subj",
        "/CN=Ezer synthetic loopback",
        "-addext",
        "subjectAltName=IP:127.0.0.1",
        "-addext",
        "basicConstraints=critical,CA:TRUE",
      ],
      { input: key, encoding: "utf8", timeout: 30000 },
    );
    if (certificate.status !== 0)
      throw new Error(
        "Acceptance TLS generation failed; OpenSSL with -addext and stdin key support is required",
      );
    const cert = certificate.stdout;
    const caFile = join(root, "public-ca.pem");
    writeFileSync(caFile, [...originalCAs, cert].join("\n"), { flag: "wx" });
    setDefaultCACertificates([...originalCAs, cert]);
    const pair = await generateKeyPair("ES256");
    const jwks = {
      keys: [
        {
          ...(await exportJWK(pair.publicKey)),
          kid: "acceptance",
          alg: "ES256",
          use: "sig",
        },
      ],
    };
    const issuer = "https://authority.test/";
    const resource = "https://memory.test/mcp";
    const policy = {
      issuer,
      resource,
      jwksUri: `${issuer}jwks`,
      bindings: [
        { subject: "alpha", individualId: "acceptance-alpha" },
        { subject: "beta", individualId: "acceptance-beta" },
      ],
    };
    function start() {
      return new Miniflare(
        convertV4MiniflareOptions({
          name: "acceptance-memory",
          scriptPath: fileURLToPath(
            new URL("../../dist/worker.js", import.meta.url),
          ),
          modules: true,
          compatibilityDate: "2026-09-26",
          compatibilityFlags: [
            "nodejs_compat",
            "nodejs_compat_do_not_populate_process_env",
            "global_fetch_strictly_public",
          ],
          host: "127.0.0.1",
          port: 0,
          log: new Log(LogLevel.NONE),
          durableObjects: {
            EZER_MEMORY: { className: "EzerMemory", useSQLite: true },
          },
          resourcePersistencePath: join(root, "storage"),
          kvNamespaces: ["OAUTH_KV"],
          bindings: { EZER_AUTHORIZATION: policy },
          outboundService: (request) =>
            request.url === policy.jwksUri
              ? MiniflareResponse.json(jwks)
              : new MiniflareResponse("Unexpected outbound request", {
                  status: 502,
                }),
        }),
      );
    }
    runtime = start();
    await runtime.ready;
    const instances = new Map<
      string,
      { name: string; marketplace: string; plugin: string; url: string }
    >();
    for (const label of ["alpha", "beta", "connect-only"]) {
      const subject = label === "connect-only" ? "alpha" : label;
      const token = await new SignJWT({
        scope:
          label === "connect-only"
            ? "ezer:connect"
            : "ezer:connect ezer:memory:read ezer:memory:write",
        client_id: "synthetic-acceptance",
      })
        .setProtectedHeader({ alg: "ES256", typ: "at+jwt", kid: "acceptance" })
        .setIssuer(issuer)
        .setAudience(resource)
        .setSubject(subject)
        .setJti(randomUUID())
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(pair.privateKey);
      const server = createServer({ key, cert }, async (request, response) => {
        try {
          if (request.url !== "/mcp") {
            response.writeHead(404).end();
            return;
          }
          const chunks: Buffer[] = [];
          let length = 0;
          for await (const chunk of request) {
            length += chunk.length;
            if (length > 64 * 1024) {
              response.writeHead(413).end();
              return;
            }
            chunks.push(Buffer.from(chunk));
          }
          const body = Buffer.concat(chunks).toString("utf8");
          if (body) {
            const message = JSON.parse(body);
            if (message.method === "tools/call")
              calls.push({
                instance: label,
                tool: message.params.name,
                arguments: message.params.arguments ?? {},
              });
          }
          const headers = new Headers();
          for (const [name, value] of Object.entries(request.headers)) {
            if (
              value !== undefined &&
              !["host", "authorization", "content-length"].includes(name)
            )
              headers.set(
                name,
                Array.isArray(value) ? value.join(", ") : value,
              );
          }
          headers.set("Authorization", `Bearer ${token}`);
          const upstream = await runtime!.dispatchFetch(resource, {
            method: request.method ?? "GET",
            headers: Object.fromEntries(headers),
            ...(body ? { body } : {}),
          });
          response.writeHead(
            upstream.status,
            Object.fromEntries(upstream.headers),
          );
          if (upstream.body)
            await pipeline(Readable.fromWeb(upstream.body), response);
          else response.end();
        } catch {
          if (!response.headersSent && !response.destroyed)
            response.writeHead(500).end("Acceptance request failed");
          else response.destroy();
        }
      });
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      servers.push(server);
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Acceptance listener failed");
      const url = `https://127.0.0.1:${address.port}/mcp`;
      const name = `ezer-acceptance-${label}-${randomUUID().slice(0, 8)}`;
      const marketplace = join(root, label);
      const result = spawnSync(
        process.execPath,
        [
          fileURLToPath(
            new URL("../../../../scripts/package-plugin.ts", import.meta.url),
          ),
          "--name",
          name,
          "--url",
          url,
          "--out",
          marketplace,
        ],
        { encoding: "utf8", timeout: 30000 },
      );
      if (result.status !== 0)
        throw new Error("Acceptance plugin packaging failed");
      instances.set(label, {
        name,
        marketplace,
        plugin: join(marketplace, "plugins", name),
        url,
      });
    }
    return {
      root,
      caFile,
      calls,
      instance(label: string) {
        const instance = instances.get(label);
        if (!instance) throw new Error("Unknown acceptance instance");
        return instance;
      },
      workspace(label: string) {
        const directory = join(root, `session-${label}-${randomUUID()}`);
        mkdirSync(directory);
        return directory;
      },
      async client(label: string) {
        const instance = instances.get(label);
        if (!instance) throw new Error("Unknown acceptance instance");
        const client = new Client({
          name: "acceptance-observer",
          version: "1",
        });
        clients.push(client);
        const manifest = JSON.parse(
          readFileSync(join(instance.plugin, ".mcp.json"), "utf8"),
        );
        const endpoint = manifest.mcpServers[instance.name].url;
        await client.connect(
          new StreamableHTTPClientTransport(new URL(endpoint)),
        );
        return client;
      },
      async restart() {
        await runtime!.dispose();
        runtime = start();
        await runtime.ready;
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
