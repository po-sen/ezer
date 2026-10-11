import {
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, parse, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const usage =
  "Usage: pnpm plugin:package --name ezer-personal --url https://memory.example.com/mcp --out dist/ezer-personal";
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
  if (!values.url || !values.out) throw new Error("arguments");
  // Only a non-secret canonical resource URL is accepted. Never echo input.
  const endpoint = new URL(values.url);
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.pathname !== "/mcp" ||
    endpoint.href !== values.url ||
    !/^[a-z0-9.-]+$/.test(endpoint.hostname)
  )
    throw new Error("url");

  const output = resolve(values.out);
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
  const nativeMcp = {
    mcpServers: { [name]: { type: "http", url: endpoint.href } },
  };
  const files: Record<string, string> = {};
  function json(path: string, data: unknown): void {
    files[path] = JSON.stringify(data, null, 2) + "\n";
  }
  json(`${pluginRoot}/plugin.json`, {
    ...manifest,
    ...metadata,
    extensions: { "com.openai": { interface: presentation } },
  });
  json(`${pluginRoot}/.codex-plugin/plugin.json`, {
    ...metadata,
    skills: "./skills/",
    mcpServers: "./.mcp.json",
    interface: presentation,
  });
  json(`${pluginRoot}/.claude-plugin/plugin.json`, {
    ...metadata,
    skills: "./skills/",
    mcpServers: "./.mcp.json",
  });
  json(`${pluginRoot}/mcp.json`, {
    $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
    mcpServers: { [name]: { type: "streamable-http", url: endpoint.href } },
  });
  json(`${pluginRoot}/.mcp.json`, nativeMcp);
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
  files[`${skillRoot}/references/connection.md`] =
    `# Instance connection\n\nInstallation and MCP server key: \`${name}\`.\n\n` +
    `Resource URL: \`${endpoint.href}\`.\n\n` +
    "Use only tools associated with this server. A host may add a plugin or MCP namespace. " +
    "If that association is unavailable, ask the user to identify the connection before reading or writing. " +
    "Never select by an ezer_* tool suffix alone. The label is not a personality or storage identity. " +
    "Call ezer_identity to recover the server-authorized individual; matching labels or IDs at different endpoints do not prove continuity. " +
    "Authenticate through the host's native OAuth flow. Never request, read, or store credentials in a skill or memory.\n";
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
    "Plugin packaging failed. Use a valid ezer-* name, a canonical HTTPS /mcp URL without credentials/query/fragment, and a new output directory with no symlink ancestors.",
  );
  console.error(usage);
  process.exitCode = 1;
}
