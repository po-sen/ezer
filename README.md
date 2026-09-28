# Ezer

Ezer is a plugin project built around Agent Skills and the Model Context Protocol
(MCP). It aims to preserve an assistant's identity and memories across agents and
computers.

The host agent provides reasoning, while an independent memory service stores
experiences. The agent decides what to remember and how to organize its memories
through use.

The project is in early development. A release for installation and deployment
is not yet available.

## Development

The planned memory service uses TypeScript and targets Cloudflare Workers. The
repository currently provides development tooling; the service package has not
been implemented yet. Installing the plugin will not require these development
dependencies.

Use Node.js 24 or later and npm. From a Git checkout, install the locked
development dependencies and activate the local Git hooks:

```sh
npm ci
```

Before each commit, Husky runs a path guard followed by lint-staged and Prettier.
The guard checks indexed filenames and filesystem metadata without reading file
contents. It rejects environment files, common key-file extensions, local
databases, dependency/build directories, experiment data, and symbolic links.
This is a filename guard, not a scan for secrets embedded in source code.

Prettier checks staged TypeScript, JavaScript, JSON, Markdown, and YAML files.
Formatting errors block the commit; the hook does not automatically fix them.
lint-staged temporarily hides unstaged portions of partially staged files and
restores them afterward. Untracked design documents and prototypes are not
included in these checks or automatically staged.

Format an explicit file, review the changes, and stage the intended result:

```sh
npm run format -- README.md
git add -- README.md
npm run check:staged
```

Use `npm run format:check -- <files>` to check explicit files without modifying
them. Hook checks run locally without calling a model or a remote service.
Service linting, type checking, and tests will be added with the TypeScript
service package. Hooks are a local convenience; CI enforcement is not configured
yet.
