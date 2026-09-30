import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
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
  if (file.startsWith("entrypoints/")) {
    const allowed: Record<string, string[]> = {
      "entrypoints/worker.ts": [
        "bootstrap/create-worker",
        "cloudflare:workers",
      ],
      "entrypoints/migrate-sqlite.ts": [
        "node:util",
        "bootstrap/create-sqlite-migrator",
      ],
      "entrypoints/migrate-postgresql.ts": [
        "node:util",
        "bootstrap/create-postgresql-migrator",
      ],
    };
    return allowed[file]?.includes(target)
      ? undefined
      : "entrypoint must delegate to its bootstrap";
  }
  if (file.startsWith("bootstrap/")) {
    return dependency.startsWith(".") &&
      (target.startsWith("modules/memory/") || target === "../package.json")
      ? undefined
      : "unregistered bootstrap dependency";
  }
  const layer = layerOf(file);
  if (
    !file.startsWith("modules/memory/") ||
    !Object.hasOwn(internalLayers, layer)
  )
    return "unregistered context or layer";
  if (!dependency.startsWith(".")) {
    const persistence = "modules/memory/infrastructure/persistence/";
    const externals: Record<string, string[]> = {
      [`${persistence}durable-object/migrate-memory.ts`]: [
        "durable-utils/sql-migrations",
      ],
      [`${persistence}sqlite/open-database.ts`]: ["node:sqlite"],
      [`${persistence}sqlite/create-migration-runner.ts`]: [
        "node:crypto",
        "node:fs",
        "node:path",
        "node:sqlite",
        "node:url",
        "postgrator",
      ],
      [`${persistence}sqlite/inspect-migrations.ts`]: [
        "node:sqlite",
        "postgrator",
      ],
      [`${persistence}sqlite/migrate-memory.ts`]: ["node:sqlite", "postgrator"],
      [`${persistence}postgresql/open-database.ts`]: ["pg"],
      [`${persistence}postgresql/read-migration-plan.ts`]: [
        "node:crypto",
        "node:fs",
        "node:path",
        "node:url",
      ],
      [`${persistence}postgresql/inspect-migrations.ts`]: ["pg"],
      [`${persistence}postgresql/migrate-memory.ts`]: [
        "pg",
        "node:path",
        "node-pg-migrate",
      ],
    };
    if (
      externals[file]?.includes(dependency) ||
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
  if (!target.startsWith("modules/memory/"))
    return "cross-context dependency outside an explicit integration";
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
      const reason = violation(file, dependency);
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
      "modules/memory/infrastructure/persistence/sqlite/migrate-memory.ts",
      "../postgresql/read-migration-plan.ts",
    ],
    [
      "modules/memory/infrastructure/persistence/sqlite/migrate-memory.ts",
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
});
