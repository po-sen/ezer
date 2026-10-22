import { spawn } from "node:child_process";

interface Instance {
  name: string;
  marketplace: string;
  plugin: string;
}

export async function runHostSession(input: {
  host: "codex" | "claude";
  instances: readonly Instance[];
  active: Instance;
  workspace: string;
  caFile: string;
  prompt: string;
}) {
  const { host, instances, active } = input;
  const args =
    host === "codex"
      ? [
          "exec",
          "--ephemeral",
          "--skip-git-repo-check",
          "--sandbox",
          "read-only",
          "--color",
          "never",
          "--json",
          "-c",
          "features.apps=true",
          "-c",
          "features.plugins=true",
          "-c",
          "features.hooks=false",
          "-c",
          "project_doc_max_bytes=0",
          ...instances.flatMap((instance) => [
            "-c",
            `marketplaces.${JSON.stringify(`${instance.name}-local`)}.source_type="local"`,
            "-c",
            `marketplaces.${JSON.stringify(`${instance.name}-local`)}.source=${JSON.stringify(instance.marketplace)}`,
            "-c",
            `plugins.${JSON.stringify(`${instance.name}@${instance.name}-local`)}.enabled=true`,
            "-c",
            `plugins.${JSON.stringify(`${instance.name}@${instance.name}-local`)}.mcp_servers.${JSON.stringify(instance.name)}.default_tools_approval_mode="auto"`,
          ]),
          "--",
          `$${active.name}:${active.name}\n${input.prompt}`,
        ]
      : [
          "-p",
          "--restricted",
          "--no-session-persistence",
          "--permission-mode",
          "dontAsk",
          "--settings",
          JSON.stringify({
            disableAllHooks: true,
            autoMemoryEnabled: false,
            syncClaudeAiPlugins: false,
          }),
          "--tools",
          "Read,Skill",
          "--allowedTools",
          "Read",
          "Skill",
          ...instances.map(
            (instance) => `mcp__plugin_${instance.name}_${instance.name}__*`,
          ),
          ...instances.flatMap((instance) => ["--plugin-dir", instance.plugin]),
          ...instances.flatMap((instance) => ["--add-dir", instance.plugin]),
          "--output-format",
          "json",
          "--",
          `/${active.name}:${active.name} ${input.prompt}`,
        ];
  const result = await new Promise<{
    code: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
  }>((resolve) => {
    const child = spawn(host, args, {
      cwd: input.workspace,
      env: {
        ...process.env,
        CODEX_CA_CERTIFICATE: input.caFile,
        NODE_EXTRA_CA_CERTS: input.caFile,
        SSL_CERT_FILE: input.caFile,
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    function stop() {
      timedOut = true;
      if (child.pid && process.platform !== "win32") {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          /* Already exited. */
        }
      } else child.kill("SIGKILL");
    }
    const timer = setTimeout(stop, 120000);
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length + chunk.length > 2_000_000) stop();
      else stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length + chunk.length > 2_000_000) stop();
      else stderr += chunk.toString();
    });
    child.once("error", () => {
      clearTimeout(timer);
      resolve({
        code: null,
        stdout: "",
        stderr: "host-unavailable",
        timedOut: false,
      });
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
  const combined = result.stdout + result.stderr;
  const reason = result.timedOut
    ? "timeout"
    : /organization has disabled Claude subscription access/.test(combined)
      ? "organization-access-denied"
      : /host-unavailable/.test(combined)
        ? "host-unavailable"
        : result.code !== 0
          ? "host-failed"
          : null;
  let answer = "";
  if (!reason) {
    if (host === "claude") {
      try {
        const parsed = JSON.parse(result.stdout);
        answer = typeof parsed.result === "string" ? parsed.result : "";
      } catch {
        /* Invalid host result is not evidence. */
      }
    } else {
      for (const line of result.stdout.split("\n")) {
        try {
          const event = JSON.parse(line);
          if (
            event.type === "item.completed" &&
            event.item?.type === "agent_message"
          )
            answer = event.item.text;
        } catch {
          /* Ignore non-event startup output. */
        }
      }
    }
  }
  return { reason, answer };
}
