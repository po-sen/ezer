import {
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import {
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const usage =
  "Usage: pnpm plugin:package --name ezer-personal (--url https://memory.example.com/mcp | --local --individual personal [--data-dir /private/data] [--allow-restore]) --out dist/ezer-personal";
const source = fileURLToPath(new URL("../plugins/ezer/", import.meta.url));

function rejectSymlinks(path: string): void {
  const absolute = resolve(path);
  let current = parse(absolute).root;
  for (const part of absolute
    .slice(current.length)
    .split(/[\\/]/)
    .filter(Boolean)) {
    current = join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) throw new Error("symlink");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
  }
}

function readSource(path: string): string {
  const location = join(source, path);
  rejectSymlinks(location);
  if (!lstatSync(location).isFile()) throw new Error("source");
  return readFileSync(location, "utf8");
}

function packagePlugin(): void {
  const { values } = parseArgs({
    options: {
      name: { type: "string" },
      url: { type: "string" },
      out: { type: "string" },
      local: { type: "boolean" },
      individual: { type: "string" },
      "data-dir": { type: "string" },
      "allow-restore": { type: "boolean" },
      help: { type: "boolean" },
    },
    allowPositionals: false,
  });
  if (values.help) {
    console.log(usage);
    return;
  }
  const name = values.name;
  if (
    !name ||
    name.length > 50 ||
    !/^ezer-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)
  )
    throw new Error("name");
  if (!values.out || (values.local ? !!values.url : !values.url))
    throw new Error("arguments");
  if (
    !values.local &&
    (values.individual || values["data-dir"] || values["allow-restore"])
  )
    throw new Error("local options require local mode");
  if (
    values.local &&
    (!values.individual ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(values.individual))
  )
    throw new Error("individual");
  if (
    values["data-dir"] &&
    (!isAbsolute(values["data-dir"]) ||
      resolve(values["data-dir"]) !== values["data-dir"])
  )
    throw new Error("data directory");
  const endpoint = values.url ? new URL(values.url) : undefined;
  if (
    endpoint &&
    (endpoint.protocol !== "https:" ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      endpoint.pathname !== "/mcp" ||
      endpoint.href !== values.url ||
      !/^[a-z0-9.-]+$/.test(endpoint.hostname))
  )
    throw new Error("url");

  const output = resolve(values.out);
  if (values["data-dir"]) {
    const dataRelative = relative(output, values["data-dir"]);
    if (
      dataRelative === "" ||
      (!dataRelative.startsWith(`..${sep}`) &&
        dataRelative !== ".." &&
        !isAbsolute(dataRelative))
    )
      throw new Error("Data directory must be outside the package");
  }
  rejectSymlinks(output);
  try {
    lstatSync(output);
    throw new Error("existing output");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  // Explicit source allowlist: never copy a worktree, environment, or prototype.
  const manifest = JSON.parse(readSource("plugin.json"));
  const skill = readSource("skills/ezer/SKILL.md")
    .replace(/^name: ezer$/m, `name: ${name}`)
    .replace(/^description: /m, `description: For ${name}. `);
  const writing = readSource("skills/ezer/references/writing-memories.md");
  const restoring = readSource("skills/ezer/references/restoring-memories.md");
  const exporting = readSource("skills/ezer/references/exporting-memories.md");
  const workspace = readSource("skills/ezer/references/workspace.md");
  const presentation = {
    ...manifest.extensions["com.openai"].interface,
    displayName: name,
    defaultPrompt: `Continue ${name} and recover memories relevant to this conversation.`,
  };
  const metadata = {
    name,
    version: manifest.version,
    description: manifest.description,
    author: manifest.author,
    repository: manifest.repository,
  };
  const pluginRoot = `plugins/${name}`;
  const skillRoot = `${pluginRoot}/skills/${name}`;
  const marketplaceName = `${name}-local`;
  const localArgs = [
    "--individual",
    values.individual!,
    ...(values["data-dir"] ? ["--data-dir", values["data-dir"]] : []),
    ...(values["allow-restore"] ? ["--allow-restore"] : []),
  ];
  function localMcp(variable: string) {
    return {
      type: "stdio",
      command: "node",
      args: [variable + "/server/entrypoints/local.mjs", ...localArgs],
    };
  }
  const nativeMcp = {
    mcpServers: {
      [name]: values.local
        ? localMcp("${CLAUDE_PLUGIN_ROOT}")
        : { type: "http", url: endpoint!.href },
    },
  };

  const files: Record<string, string> = {};
  function json(path: string, data: unknown): void {
    files[path] = JSON.stringify(data, null, 2) + "\n";
  }
  json(`${pluginRoot}/plugin.json`, {
    ...manifest,
    ...metadata,
    extensions: {
      "com.openai": {
        interface: presentation,
        ...(values.local ? { requires_local_executor: true } : {}),
      },
    },
  });
  json(`${pluginRoot}/.codex-plugin/plugin.json`, {
    ...metadata,
    skills: "./skills/",
    mcpServers: values.local ? "./.codex-mcp.json" : "./.mcp.json",
    ...(values.local ? { requires_local_executor: true } : {}),
    interface: presentation,
  });
  json(`${pluginRoot}/.claude-plugin/plugin.json`, {
    ...metadata,
    skills: "./skills/",
    mcpServers: "./.mcp.json",
  });
  json(`${pluginRoot}/mcp.json`, {
    $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
    mcpServers: {
      [name]: values.local
        ? localMcp("${PLUGIN_ROOT}")
        : { type: "streamable-http", url: endpoint!.href },
    },
  });
  json(`${pluginRoot}/.mcp.json`, nativeMcp);
  if (values.local) {
    json(`${pluginRoot}/.codex-mcp.json`, {
      mcpServers: { [name]: localMcp("${PLUGIN_ROOT}") },
    });
    execFileSync("pnpm", ["--filter", "@ezer/memory", "run", "build:local"], {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const runtime = fileURLToPath(
      new URL("../apps/ezer-memory/dist/local/", import.meta.url),
    );
    rejectSymlinks(join(runtime, "manifest.json"));
    const build = JSON.parse(
      readFileSync(join(runtime, "manifest.json"), "utf8"),
    ) as { files: string[] };
    if (
      !Array.isArray(build.files) ||
      !build.files.includes("entrypoints/local.mjs")
    )
      throw new Error("build manifest");
    for (const file of build.files) {
      if (
        !/^(?:THIRD_PARTY_NOTICES\.txt|entrypoints\/local\.mjs(?:\.map)?|modules\/(?:memory|workspace)\/infrastructure\/persistence\/sqlite\/migrations\/(?:checksums\.json|[0-9]{6}\.(?:do|undo)\.\w+\.sql))$/.test(
          file,
        )
      )
        throw new Error("unexpected build asset");
      const path = join(runtime, file);
      rejectSymlinks(path);
      if (!lstatSync(path).isFile()) throw new Error("build asset");
      files[`${pluginRoot}/server/${file}`] = readFileSync(path, "utf8");
    }
  }
  json(".agents/plugins/marketplace.json", {
    name: marketplaceName,
    interface: { displayName: name },
    plugins: [
      {
        name,
        source: { source: "local", path: `./${pluginRoot}` },
        policy: { installation: "AVAILABLE", authentication: "ON_USE" },
      },
    ],
  });
  json(".claude-plugin/marketplace.json", {
    name: marketplaceName,
    owner: manifest.author,
    metadata: { description: "A configured Ezer memory plugin instance." },
    plugins: [{ name, source: `./${pluginRoot}` }],
  });
  files[`${skillRoot}/SKILL.md`] = skill;
  files[`${skillRoot}/references/writing-memories.md`] = writing;
  files[`${skillRoot}/references/exporting-memories.md`] = exporting;
  files[`${skillRoot}/references/restoring-memories.md`] = restoring;
  files[`${skillRoot}/references/workspace.md`] = workspace;
  files[`${skillRoot}/references/connection.md`] =
    `# Instance connection\n\nInstallation and MCP server key: \`${name}\`.\n\n` +
    (values.local
      ? `Local stdio server, bound to individual \`${values.individual}\`. The workspace tools are available.\n\n`
      : `Resource URL: \`${endpoint!.href}\`.\n\n`) +
    "Use only tools associated with this server. A host may add a plugin or MCP namespace. " +
    "If that association is unavailable, ask the user to identify the connection before reading or writing. " +
    "Never select by an ezer_* tool suffix alone. The label is not a personality or storage identity. " +
    "Call ezer_identity to recover the server-authorized individual; matching labels or IDs at different endpoints do not prove continuity. " +
    (values.local
      ? "This process uses the OS owner\'s local access; it does not use OAuth. The operator chooses identity, data location and restore permission at launch. Never change those settings or open the databases directly.\n"
      : "Authenticate through the host\'s native OAuth flow. Never request, read, or store credentials in a skill or memory.\n");
  files["README.md"] =
    `# ${name}\n\nGenerated Ezer ${manifest.version} marketplace. This package contains a public endpoint URL, not credentials or memories.\n\n` +
    "On the machine running your agent, register this directory using:\n\n" +
    "\`\`\`sh\n" +
    "codex plugin marketplace add /absolute/path/to/this-directory\n" +
    `codex plugin add ${name}@${marketplaceName}\n\n` +
    "claude plugin marketplace add /absolute/path/to/this-directory\n" +
    `claude plugin install ${name}@${marketplaceName}\n` +
    "\`\`\`\n\n" +
    "Use only your host's commands, then restart its session and authenticate this MCP server through its native connection UI. " +
    `Explicitly activate ${name} in a new conversation. In Claude Code the skill is /${name}:${name}.\n\n` +
    "A reachable, configured ezer-memory service and compatible OAuth authority are prerequisites. " +
    "Generating or installing the package does not verify them or automatically activate the skill in every conversation. " +
    "Keep this directory for marketplace refreshes. Distribute the whole directory, including hidden manifests, to another agent host.\n";

  if (values.local) {
    files["README.md"] =
      files["README.md"]!.replace(
        "a public endpoint URL, not credentials or memories",
        "a bundled Node stdio server and its launch settings, not memories or credentials",
      )
        .replace(
          "and authenticate this MCP server through its native connection UI",
          "with Node.js 24.5 or newer on PATH",
        )
        .replace(
          "A reachable, configured ezer-memory service and compatible OAuth authority are prerequisites.",
          "Node.js 24.5 or newer is required. This mode needs no Cloudflare service, OAuth, listening port or dependency installation at runtime.",
        ) +
      `\nThe server binds to individual \`${values.individual}\`. Data lives in ${values["data-dir"] ? "the configured private directory" : "~/.ezer/individuals"}/<individual>/, independently of plugin versions and uninstall. Keep that directory on a local disk, private to its OS owner. A data directory is not an OS sandbox; another process with the same OS user's access can read it.\n\n` +
      "Memory and workspace use separate SQLite databases. Workspace files are managed logical paths (not a mounted filesystem); use MCP to list/read/write files, including base64 attachments up to 1 MiB. Earlier versions and trash are retained. Memory exports do not contain workspace files. To make a cold backup, stop every Ezer process using that individual and copy the whole individual directory; live copying or cloud-sync folders are unsupported.\n\n" +
      "Two agent hosts on the same computer can use the same individual and data directory. Different individuals have separate stores. Installing on another computer does not synchronize data. Restore permission is disabled unless packaged with --allow-restore, and restoring still requires an explicit user request.\n";
  }
  mkdirSync(dirname(output), { recursive: true });
  mkdirSync(output); // Claim a new directory; never replace an installation.
  try {
    for (const [path, content] of Object.entries(files)) {
      const target = join(output, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content, { flag: "wx" });
    }
  } catch (error) {
    rmSync(output, { recursive: true, force: true });
    throw error;
  }
  console.log(
    `Packaged ${name}. See the generated README.md for installation.`,
  );
}

try {
  packagePlugin();
} catch {
  // Parser and filesystem errors can echo input, including a mistaken secret.
  console.error(
    "Plugin packaging failed. Use a valid ezer-* name, either a canonical HTTPS /mcp URL or --local --individual <id>, and a new output directory with no symlink ancestors. Local packaging requires installed build dependencies; data-dir must be absolute.",
  );
  console.error(usage);
  process.exitCode = 1;
}
