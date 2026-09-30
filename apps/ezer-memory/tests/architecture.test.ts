import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
const repositoryRoot = resolve(sourceRoot, "../../..");
const internalLayers: Record<string, readonly string[]> = {
  domain: ["domain"],
  "ports/inbound": ["ports/inbound"],
  "ports/outbound": ["domain", "ports/outbound"],
  application: ["domain", "ports/inbound", "ports/outbound", "application"],
  infrastructure: ["ports/outbound", "infrastructure"],
  delivery: ["ports/inbound", "delivery"],
};

function layerOf(file: string): string {
  const parts = file.split("/");
  return parts[2] === "ports" ? parts.slice(2, 4).join("/") : (parts[2] ?? "");
}

function violation(file: string, dependency: string): string | undefined {
  const target = dependency.startsWith(".")
    ? relative(sourceRoot, resolve(sourceRoot, dirname(file), dependency))
        .split(sep)
        .join("/")
        .replace(/\.ts$/, "")
    : dependency;
  const facades: Record<string, readonly string[]> = {
    "index.ts": ["entrypoints/worker"],
    "modules/index.ts": ["modules/memory/index", "modules/access/index"],
    "modules/access/index.ts": ["modules/access/ports/index"],
    "modules/access/ports/index.ts": ["modules/access/ports/inbound/index"],
    "modules/memory/index.ts": ["modules/memory/ports/index"],
    "modules/memory/ports/index.ts": ["modules/memory/ports/inbound/index"],
  };
  if (facades[file])
    return facades[file]!.some(
      (allowed) =>
        target === allowed || target.startsWith(`${dirname(allowed)}/`),
    )
      ? undefined
      : "context facade must expose its declared public API";
  if (file.startsWith("entrypoints/")) {
    return /^bootstrap\/[^/]+$/.test(target) ||
      ["cloudflare:workers", "node:util"].includes(target)
      ? undefined
      : "entrypoint must delegate to its corresponding bootstrap";
  }
  if (file.startsWith("bootstrap/")) {
    return dependency.startsWith(".") &&
      (["modules/memory/", "modules/access/"].some((prefix) =>
        target.startsWith(prefix),
      ) ||
        target === "../package.json")
      ? undefined
      : "unregistered bootstrap dependency";
  }
  const layer = layerOf(file);
  const context = file.split("/")[1];
  if (
    !["memory", "access"].includes(context ?? "") ||
    !Object.hasOwn(internalLayers, layer)
  )
    return "unregistered context or layer";
  if (!dependency.startsWith(".")) {
    const persistence = "modules/memory/infrastructure/persistence/";
    const externals: Record<string, readonly string[]> = {
      "modules/access/infrastructure/configuration/": ["zod"],
      "modules/access/infrastructure/jwt/": ["jose"],
      [`${persistence}durable-object/`]: ["durable-utils/sql-migrations"],
      [`${persistence}sqlite/cli/`]: [
        "node:crypto",
        "node:fs",
        "node:path",
        "node:sqlite",
        "node:url",
        "postgrator",
      ],
      [`${persistence}postgresql/`]: [
        "node:crypto",
        "node:fs",
        "node:path",
        "node:url",
        "pg",
        "node-pg-migrate",
      ],
    };
    if (
      Object.entries(externals).some(
        ([directory, dependencies]) =>
          file.startsWith(directory) && dependencies.includes(dependency),
      ) ||
      (layer === "delivery" &&
        ["@modelcontextprotocol/server", "zod"].includes(dependency))
    )
      return;
    return "external dependency in an inner layer or unregistered adapter";
  }
  const targetLayer = layerOf(target);
  if (layer === "infrastructure" && targetLayer === "infrastructure") {
    const sourceDirectory = dirname(file);
    const targetDirectory = dirname(target);
    if (
      sourceDirectory !== targetDirectory &&
      !targetDirectory.startsWith(`${sourceDirectory}/`) &&
      !sourceDirectory.startsWith(`${targetDirectory}/`)
    )
      return "infrastructure cannot import a sibling directory";
  }
  if (!target.startsWith(`modules/${context}/`)) {
    // Only the MCP/HTTP delivery boundary may consume Access's public contracts.
    if (
      file.startsWith("modules/memory/delivery/") &&
      (target.startsWith("modules/access/ports/inbound/") ||
        ["modules/access/index", "modules/access/ports/index"].includes(target))
    )
      return;
    return "cross-context dependency outside an explicit integration";
  }
  if (!internalLayers[layer]!.includes(targetLayer))
    return "dependency points outside the allowed layers";
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    assert(!entry.isSymbolicLink(), "source files must not be symlinks");
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && /\.(?:ts|tsx|mts|cts)$/.test(entry.name)
      ? [path]
      : [];
  });
}

function pathViolation(file: string, dependency: string): string | undefined {
  if (!dependency.startsWith(".") || dependency.endsWith(".json")) return;
  const directory = resolve(sourceRoot, dirname(file));
  const target = resolve(directory, dependency);
  if (!dependency.endsWith(".ts"))
    return "source imports must use an explicit .ts extension";
  if (
    dirname(target) !== directory &&
    basename(target) !== "index.ts" &&
    !["bootstrap", "entrypoints"].some(
      (directory) => dirname(target) === resolve(sourceRoot, directory),
    )
  )
    return "cross-directory imports must use index.ts";
  if (
    dirname(target) === directory &&
    basename(target) === "index.ts" &&
    basename(file) !== "index.ts"
  )
    return "implementation files must not import their own barrel";
}

function importViolations(file: string, text: string): string[] {
  const failures: string[] = [];
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const inspect = (node: ts.Node) => {
    let dependency: string | undefined;
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier
    ) {
      assert(ts.isStringLiteral(node.moduleSpecifier));
      dependency = node.moduleSpecifier.text;
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      dependency = node.argument.literal.text;
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require"))
    ) {
      failures.push(`${file}: runtime imports are not allowed in this service`);
    }
    if (dependency !== undefined) {
      const reason =
        pathViolation(file, dependency) ?? violation(file, dependency);
      if (reason) failures.push(`${file} -> ${dependency}: ${reason}`);
    }
    ts.forEachChild(node, inspect);
  };
  inspect(source);
  return failures;
}

test("production imports respect context ownership and inward dependencies", () => {
  const failures: string[] = [];
  for (const path of sourceFiles(sourceRoot)) {
    const file = relative(sourceRoot, path).split(sep).join("/");
    failures.push(...importViolations(file, readFileSync(path, "utf8")));
  }
  assert.deepEqual(failures, []);
});

test("the boundary guard rejects SDK leakage, reversed dependencies, and foreign domains", () => {
  for (const [file, dependency] of [
    ["modules/memory/domain/memory.ts", "@modelcontextprotocol/server"],
    [
      "modules/memory/ports/inbound/commit-memory.ts",
      "../../domain/memory-revision",
    ],
    [
      "modules/memory/ports/outbound/revision-store.ts",
      "../inbound/inspect-memory",
    ],
    [
      "modules/memory/infrastructure/request-fingerprint.ts",
      "durable-utils/sql-migrations",
    ],
    ["modules/memory/application/remember.ts", "../infrastructure/sqlite"],
    ["modules/memory/delivery/mcp.ts", "../application/remember"],
    ["modules/memory/ports/inbound/recall.ts", "cloudflare:workers"],
    ["modules/memory/application/recall.ts", "../../identity/domain/owner"],
    [
      "modules/memory/application/recall.ts",
      "@/modules/memory/infrastructure/sqlite",
    ],
    [
      "modules/memory/domain/memory.ts",
      "../infrastructure/sqlite-memory-store",
    ],
    [
      "modules/memory/infrastructure/sqlite-memory-store.ts",
      "../application/commit-memory",
    ],
    [
      "entrypoints/worker.ts",
      "../modules/memory/infrastructure/sqlite-memory-store",
    ],
    [
      "modules/memory/infrastructure/persistence/sqlite/session.ts",
      "../durable-object/session",
    ],
    [
      "modules/memory/infrastructure/persistence/durable-object/unit-of-work.ts",
      "../sqlite/revision-store",
    ],
    [
      "modules/memory/infrastructure/persistence/durable-object/migrate-memory.ts",
      "../sqlite/migrations/migrations.generated",
    ],
    [
      "modules/memory/infrastructure/persistence/durable-object/session.ts",
      "../../../domain/memory-revision",
    ],
    [
      "entrypoints/migrate-sqlite.ts",
      "../modules/memory/infrastructure/persistence/sqlite/migrate-memory.ts",
    ],
    [
      "modules/memory/infrastructure/persistence/postgresql/migrate-memory.ts",
      "../sqlite/migrations/migrations.generated.ts",
    ],
    [
      "modules/memory/infrastructure/persistence/sqlite/cli/migrate-memory.ts",
      "../postgresql/read-migration-plan.ts",
    ],
    [
      "modules/memory/infrastructure/persistence/sqlite/cli/migrate-memory.ts",
      "durable-utils/sql-migrations",
    ],
  ] as const) {
    assert(
      violation(file, dependency),
      `${file} must not import ${dependency}`,
    );
  }
  assert.equal(
    violation(
      "modules/memory/application/recall.ts",
      "../ports/inbound/recall",
    ),
    undefined,
  );
  assert.equal(
    violation("modules/memory/delivery/mcp.ts", "@modelcontextprotocol/server"),
    undefined,
  );
  assert.equal(
    violation(
      "modules/memory/infrastructure/persistence/durable-object/unit-of-work.ts",
      "./revision-store",
    ),
    undefined,
  );
});

test("infrastructure boundaries include type imports and re-exports", () => {
  for (const source of [
    'import { migrations } from "../sqlite/migrations/migrations.generated";',
    'import type { SqlSession } from "../sqlite/session";',
    'type Session = import("../sqlite/session").SqlSession;',
    'export { migrations } from "../sqlite/migrations/migrations.generated";',
    'export type { SqlSession } from "../sqlite/session";',
    'export * from "../sqlite/session";',
  ]) {
    assert(
      importViolations(
        "modules/memory/infrastructure/persistence/durable-object/x.ts",
        source,
      ).length > 0,
      source,
    );
  }
  for (const dependency of [
    "./session",
    "./migrations/migrations.generated",
    "../contract",
    "../../../ports/outbound/unit-of-work",
  ]) {
    assert.equal(
      violation(
        "modules/memory/infrastructure/persistence/durable-object/x.ts",
        dependency,
      ),
      undefined,
    );
  }
});

function responsibilityViolations(file: string, text: string): string[] {
  const failures: string[] = [];
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const layer = layerOf(file);
  const generatedSql = ["sqlite", "durable-object"].some((adapter) =>
    ["migrations", "reversals"].some(
      (name) =>
        file ===
        `modules/memory/infrastructure/persistence/${adapter}/migrations/${name}.generated.ts`,
    ),
  );
  const sqlite = file.startsWith(
    "modules/memory/infrastructure/persistence/sqlite/",
  );
  const persistence =
    sqlite ||
    file.startsWith(
      "modules/memory/infrastructure/persistence/durable-object/",
    ) ||
    file.startsWith("modules/memory/infrastructure/persistence/postgresql/");
  const inner = [
    "domain",
    "application",
    "ports/inbound",
    "ports/outbound",
  ].includes(layer ?? "");
  const inspect = (node: ts.Node) => {
    if (
      (inner || sqlite) &&
      ts.isIdentifier(node) &&
      [
        "DurableObjectStorage",
        "SqlStorage",
        "SqlStorageCursor",
        "SqlStorageValue",
        "DurableObjectState",
        "DurableObject",
        "DurableObjectNamespace",
        "DurableObjectId",
        "DurableObjectStub",
        "Cloudflare",
        "Env",
        "Request",
        "Response",
        "fetch",
        "crypto",
      ].includes(node.text)
    )
      failures.push("native capability outside runtime adapter");
    if (ts.isStringLiteralLike(node)) {
      if (
        !generatedSql &&
        /\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|INDEX|TRIGGER)\b/i.test(node.text)
      )
        failures.push("DDL outside versioned migrations");
      if (
        !persistence &&
        /\b(?:SELECT\s+.+\s+FROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i.test(
          node.text,
        )
      )
        failures.push("SQL outside owning persistence adapter");
    }
    if (
      file.startsWith("bootstrap/") &&
      (ts.isIfStatement(node) ||
        ts.isSwitchStatement(node) ||
        ts.isTryStatement(node))
    )
      failures.push("workflow branching in bootstrap");
    if (
      layer === "domain" &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ["Date.now", "Math.random"].includes(node.expression.getText(source))
    )
      failures.push("ambient clock or randomness in domain");
    ts.forEachChild(node, inspect);
  };
  inspect(source);
  return failures;
}

test("source responsibilities exclude native handles, embedded DDL, and bootstrap policy", () => {
  for (const path of sourceFiles(sourceRoot)) {
    const file = relative(sourceRoot, path).split(sep).join("/");
    assert.deepEqual(
      responsibilityViolations(file, readFileSync(path, "utf8")),
      [],
      file,
    );
  }
  for (const [file, text] of [
    ["modules/memory/domain/x.ts", "const now = Date.now();"],
    ["modules/memory/application/x.ts", "let storage: DurableObjectStorage;"],
    [
      "modules/memory/infrastructure/persistence/sqlite/x.ts",
      "const sql = `CREATE TABLE hidden (id INTEGER)`;",
    ],
    ["bootstrap/x.ts", "if (owner) save();"],
    [
      "modules/memory/application/x.ts",
      "const sql = 'SELECT * FROM revisions';",
    ],
    [
      "modules/memory/infrastructure/persistence/sqlite/x.ts",
      "let storage: DurableObjectStorage;",
    ],
    [
      "modules/memory/infrastructure/persistence/sqlite/x.ts",
      "type Value = SqlStorageValue;",
    ],
    [
      "modules/memory/infrastructure/request-fingerprint.ts",
      "const sql = 'SELECT * FROM state';",
    ],
  ])
    assert(responsibilityViolations(file!, text!).length > 0, file);
});

test("SQLite compiles with Node declarations and without Cloudflare", () => {
  const program = ts.createProgram(
    sourceFiles(
      resolve(sourceRoot, "modules/memory/infrastructure/persistence/sqlite"),
    ),
    {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      lib: ["lib.es2022.d.ts"],
      types: ["node"],
      typeRoots: [resolve(sourceRoot, "../node_modules/@types")],
      allowImportingTsExtensions: true,
      skipLibCheck: true,
      strict: true,
      noUncheckedIndexedAccess: true,
      exactOptionalPropertyTypes: true,
      noEmit: true,
    },
  );
  assert.deepEqual(
    ts
      .getPreEmitDiagnostics(program)
      .map((diagnostic) =>
        ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      ),
    [],
  );
});

function pairingViolations(files: ReadonlyMap<string, string>): string[] {
  const entrypoints = [...files.keys()].filter((file) =>
    file.startsWith("entrypoints/"),
  );
  const bootstraps = [...files.keys()].filter((file) =>
    file.startsWith("bootstrap/"),
  );
  const failures: string[] = [];
  const owners = new Map<string, string[]>();
  for (const file of [...entrypoints, ...bootstraps]) {
    if (file.split("/").length !== 2 || basename(file) === "index.ts")
      failures.push(`${file} must be a flat, named runtime module`);
  }
  if (entrypoints.length !== bootstraps.length)
    failures.push("entrypoints and bootstrap must have equal file counts");
  for (const entrypoint of entrypoints) {
    const source = ts.createSourceFile(
      entrypoint,
      files.get(entrypoint)!,
      ts.ScriptTarget.Latest,
      true,
    );
    const dependencies = new Set<string>();
    const inspect = (node: ts.Node) => {
      let dependency: string | undefined;
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        dependency = node.moduleSpecifier.text;
      if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteral(node.argument.literal)
      )
        dependency = node.argument.literal.text;
      if (dependency !== undefined) {
        const target = relative(
          sourceRoot,
          resolve(sourceRoot, dirname(entrypoint), dependency),
        )
          .split(sep)
          .join("/");
        if (target.startsWith("bootstrap/")) dependencies.add(target);
      }
      ts.forEachChild(node, inspect);
    };
    inspect(source);
    if (dependencies.size !== 1)
      failures.push(`${entrypoint} must import exactly one bootstrap module`);
    for (const dependency of dependencies) {
      if (!bootstraps.includes(dependency))
        failures.push(
          `${entrypoint} imports a missing bootstrap: ${dependency}`,
        );
      owners.set(dependency, [...(owners.get(dependency) ?? []), entrypoint]);
    }
  }
  for (const bootstrap of bootstraps) {
    if (owners.get(bootstrap)?.length !== 1)
      failures.push(`${bootstrap} must belong to exactly one entrypoint`);
  }
  return failures;
}

test("entrypoints and bootstrap have equal file counts and pair one-to-one", () => {
  const paths = ["entrypoints", "bootstrap"].flatMap((directory) =>
    sourceFiles(resolve(sourceRoot, directory)),
  );
  const files = new Map(
    paths.map((path) => [
      relative(sourceRoot, path).split(sep).join("/"),
      readFileSync(path, "utf8"),
    ]),
  );
  assert.deepEqual(pairingViolations(files), []);
});

test("the pairing guard rejects shared, missing, orphaned, and multiple bootstraps", () => {
  const valid = new Map([
    ["entrypoints/a.ts", 'import { createA } from "../bootstrap/a.ts";'],
    ["entrypoints/b.ts", 'import { createB } from "../bootstrap/b.ts";'],
    ["bootstrap/a.ts", "export function createA() {}"],
    ["bootstrap/b.ts", "export function createB() {}"],
  ]);
  assert.deepEqual(pairingViolations(valid), []);
  for (const replacement of [
    'import { createA } from "../bootstrap/a.ts";',
    'import { missing } from "../bootstrap/missing.ts";',
    'import { createA } from "../bootstrap/a.ts"; import { createB } from "../bootstrap/b.ts";',
    'import { createB } from "../bootstrap/b.ts"; export { createA } from "../bootstrap/a.ts";',
    'import { createB } from "../bootstrap/b.ts"; type Other = typeof import("../bootstrap/a.ts");',
    "export default {};",
  ]) {
    const invalid = new Map(valid);
    invalid.set("entrypoints/b.ts", replacement);
    assert(pairingViolations(invalid).length > 0, replacement);
  }
  const orphan = new Map(valid);
  orphan.set("bootstrap/orphan.ts", "export const orphan = {};");
  assert(pairingViolations(orphan).length > 0);
  for (const name of ["index.ts", "migrate-sqlite/index.ts"]) {
    assert(
      pairingViolations(
        new Map([
          [
            `entrypoints/${name}`,
            `export { create } from "${name.includes("/") ? "../../" : "../"}bootstrap/${name}";`,
          ],
          [`bootstrap/${name}`, "export function create() {}"],
        ]),
      ).length > 0,
      name,
    );
  }
});

function importedOrigins(
  symbol: ts.Symbol,
  checker: ts.TypeChecker,
  seen = new Set<ts.Symbol>(),
): string[] {
  if (seen.has(symbol)) return [];
  seen.add(symbol);
  if (symbol.flags & ts.SymbolFlags.Alias)
    return importedOrigins(checker.getAliasedSymbol(symbol), checker, seen);
  if (symbol.flags & ts.SymbolFlags.Module)
    return checker
      .getExportsOfModule(symbol)
      .flatMap((member) => importedOrigins(member, checker, seen));
  return (symbol.declarations ?? []).map(
    (declaration) => declaration.getSourceFile().fileName,
  );
}

function provenanceViolations(program: ts.Program, path: string): string[] {
  const source = program.getSourceFile(path)!;
  const checker = program.getTypeChecker();
  const file = relative(sourceRoot, path).split(sep).join("/");
  const failures: string[] = [];
  const inspect = (node: ts.Node) => {
    const references: ts.Node[] = [];
    if (ts.isImportDeclaration(node)) {
      if (node.importClause?.name) references.push(node.importClause.name);
      const bindings = node.importClause?.namedBindings;
      if (bindings)
        references.push(
          ...(ts.isNamedImports(bindings)
            ? bindings.elements.map((element) => element.name)
            : [bindings.name]),
        );
      if (!node.importClause) references.push(node.moduleSpecifier);
    } else if (ts.isExportDeclaration(node)) {
      if (node.exportClause)
        references.push(
          ...(ts.isNamedExports(node.exportClause)
            ? node.exportClause.elements.map((element) => element.name)
            : [node.exportClause.name]),
        );
      else if (node.moduleSpecifier) references.push(node.moduleSpecifier);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument)
    ) {
      references.push(node.qualifier ?? node.argument.literal);
    }
    for (const reference of references) {
      const symbol = checker.getSymbolAtLocation(reference);
      if (!symbol) continue; // Type checking reports unresolved imports.
      for (const origin of new Set(importedOrigins(symbol, checker))) {
        if (!origin.startsWith(sourceRoot)) continue;
        let dependency = relative(dirname(path), origin).split(sep).join("/");
        if (!dependency.startsWith(".")) dependency = `./${dependency}`;
        const reason = violation(file, dependency);
        if (reason)
          failures.push(
            `${file} resolves to ${relative(sourceRoot, origin)}: ${reason}`,
          );
      }
    }
    ts.forEachChild(node, inspect);
  };
  inspect(source);
  return failures;
}

test("source folders expose explicit indexes without bypassing dependency ownership", () => {
  const paths = sourceFiles(sourceRoot);
  const directories = new Set<string>();
  for (const path of paths) {
    // Executable entrypoints and composition factories use flat, named modules.
    const file = relative(sourceRoot, path).split(sep).join("/");
    if (file.startsWith("bootstrap/") || file.startsWith("entrypoints/"))
      continue;
    // Native PostgreSQL migrations are discovered as files, not imported as a module.
    if (
      path.startsWith(
        resolve(
          sourceRoot,
          "modules/memory/infrastructure/persistence/postgresql/migrations",
        ) + sep,
      )
    )
      continue;
    let directory = dirname(path);
    while (directory.startsWith(sourceRoot.replace(/\/$/, ""))) {
      directories.add(directory);
      if (directory === sourceRoot.replace(/\/$/, "")) break;
      directory = dirname(directory);
    }
  }
  for (const directory of directories)
    assert(
      paths.includes(resolve(directory, "index.ts")),
      `Missing index.ts in ${directory}`,
    );
  const program = ts.createProgram(paths, {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
    noEmit: true,
    skipLibCheck: true,
  });
  for (const path of paths) {
    assert.deepEqual(provenanceViolations(program, path), []);
  }
});

function isPureBarrel(source: ts.SourceFile): boolean {
  return source.statements.every(
    (statement) =>
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier !== undefined &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.exportClause !== undefined,
  );
}

test("tracked TypeScript imports use indexes across directories", () => {
  execFileSync(
    process.execPath,
    [resolve(repositoryRoot, "scripts/check-staged-paths.ts")],
    { cwd: repositoryRoot },
  );
  const paths = execFileSync(
    "git",
    ["ls-files", "--cached", "-z", "*.ts", "*.tsx", "*.mts", "*.cts"],
    { cwd: repositoryRoot, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);
  const failures: string[] = [];
  for (const path of paths) {
    if (path === "apps/ezer-memory/worker-configuration.d.ts") continue;
    const source = ts.createSourceFile(
      path,
      readFileSync(resolve(repositoryRoot, path), "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    if (basename(path) === "index.ts" && !isPureBarrel(source))
      failures.push(`${path} must contain only explicit re-exports`);
    const inspect = (node: ts.Node) => {
      let dependency: string | undefined;
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        dependency = node.moduleSpecifier.text;
      if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteral(node.argument.literal)
      )
        dependency = node.argument.literal.text;
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            node.expression.text === "require")) &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      )
        dependency = node.arguments[0].text;
      if (dependency !== undefined) {
        const reason = pathViolation(resolve(repositoryRoot, path), dependency);
        if (reason) failures.push(`${path} -> ${dependency}: ${reason}`);
      }
      ts.forEachChild(node, inspect);
    };
    inspect(source);
  }
  assert.deepEqual(failures, []);
  for (const dependency of [
    "../domain/memory-revision.ts",
    "../domain",
    "./index.ts",
  ])
    assert(pathViolation("modules/memory/application/commit.ts", dependency));
  for (const dependency of [
    "../domain/index.ts",
    "./helper.ts",
    "node:crypto",
    "../../package.json",
  ])
    assert.equal(
      pathViolation("modules/memory/application/commit.ts", dependency),
      undefined,
    );
  assert.equal(
    pathViolation("entrypoints/worker.ts", "../bootstrap/create-worker.ts"),
    undefined,
  );
  assert(
    pathViolation(
      "bootstrap/create-worker.ts",
      "../modules/memory/application/commit-memory.ts",
    ),
  );
});

test("index files contain only explicit re-exports", () => {
  for (const [content, expected] of [
    ['export { createWorker } from "./create-worker.ts";', true],
    ['export type { MemoryWrite } from "./memory-write.ts";', true],
    ['export { default } from "./worker.ts";', true],
    ['export type * as Adapter from "./adapter/index.ts";', true],
    [
      'import { createWorker } from "./create-worker.ts"; export { createWorker };',
      false,
    ],
    ["export function createWorker() {}", false],
    ["export class Worker {}", false],
    ["export const worker = {};", false],
    ["export interface Memory {}", false],
    ["export default createWorker();", false],
    ['console.log("initialized");', false],
  ] as const) {
    assert.equal(
      isPureBarrel(
        ts.createSourceFile("index.ts", content, ts.ScriptTarget.Latest, true),
      ),
      expected,
      content,
    );
  }
});

test("parent indexes cannot hide sibling adapters or reverse layer dependencies", () => {
  const adapter = "modules/memory/infrastructure/persistence/";
  const siblingCaller = `${adapter}durable-object/example.ts`;
  const applicationCaller = "modules/memory/application/example.ts";
  const sources = new Map<string, string>([
    [`${adapter}sqlite/session.ts`, "export interface SqlSession {}"],
    [
      `${adapter}sqlite/index.ts`,
      'export type { SqlSession } from "./session.ts";',
    ],
    [
      `${adapter}index.ts`,
      'export type { SqlSession } from "./sqlite/index.ts";',
    ],
    [
      "modules/memory/ports/inbound/index.ts",
      'export type { SqlSession } from "../../infrastructure/persistence/sqlite/index.ts";',
    ],
  ]);
  const siblingCases = [
    'import type { SqlSession } from "../index.ts";',
    'import type * as adapter from "../index.ts";',
    'type Session = import("../index.ts").SqlSession;',
    'export type { SqlSession } from "../index.ts";',
    'export type * from "../index.ts";',
  ];
  const cases: [string, string][] = [
    ...siblingCases.map((content): [string, string] => [
      siblingCaller,
      content,
    ]),
    [
      applicationCaller,
      'import type { SqlSession } from "../ports/inbound/index.ts";',
    ],
  ];
  for (const [caller, content] of cases) {
    const files = new Map(
      [...sources, [caller, content] as const].map(([path, source]) => [
        resolve(sourceRoot, path),
        source,
      ]),
    );
    const options: ts.CompilerOptions = {
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
      noLib: true,
      types: [],
    };
    const host = ts.createCompilerHost(options);
    host.fileExists = (path) => files.has(path);
    host.readFile = (path) => files.get(path);
    host.getSourceFile = (path, version) =>
      files.has(path)
        ? ts.createSourceFile(path, files.get(path)!, version, true)
        : undefined;
    const program = ts.createProgram([...files.keys()], options, host);
    assert(
      provenanceViolations(program, resolve(sourceRoot, caller)).length > 0,
      content,
    );
  }
});

test("access integrations expose only inbound contracts to memory delivery", () => {
  for (const [file, dependency] of [
    ["modules/memory/application/x.ts", "../../../access/index.ts"],
    ["modules/memory/delivery/x.ts", "../../access/application/index.ts"],
    ["modules/memory/delivery/x.ts", "../../access/ports/outbound/index.ts"],
    ["modules/access/application/x.ts", "../../memory/ports/inbound/index.ts"],
    ["modules/access/domain/x.ts", "jose"],
    ["modules/access/infrastructure/jwt/x.ts", "../configuration/index.ts"],
  ])
    assert(violation(file!, dependency!), file);
  assert.equal(
    violation("modules/memory/delivery/http.ts", "../../access/index.ts"),
    undefined,
  );
  assert.equal(
    violation(
      "modules/memory/delivery/http.ts",
      "../../access/ports/inbound/access-control.ts",
    ),
    undefined,
  );
});
