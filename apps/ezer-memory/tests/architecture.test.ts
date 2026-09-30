import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
const internalLayers: Record<string, readonly string[]> = {
  domain: ["domain"],
  inboundport: ["inboundport"],
  outboundport: ["domain", "outboundport"],
  application: ["domain", "inboundport", "outboundport", "application"],
  infrastructure: ["domain", "outboundport", "infrastructure"],
  delivery: ["inboundport", "delivery"],
};

function violation(file: string, dependency: string): string | undefined {
  const [context, layer] = file.split("/");
  if (context === "bootstrap") {
    if (
      dependency === "cloudflare:workers" ||
      dependency.startsWith("../memory/") ||
      dependency === "../../package.json"
    )
      return;
    return "unregistered bootstrap dependency";
  }
  if (file === "index.ts") {
    return ["./bootstrap/worker", "./bootstrap/ezer-memory"].includes(
      dependency,
    )
      ? undefined
      : "entry point must delegate to bootstrap";
  }
  if (
    context !== "memory" ||
    layer === undefined ||
    !Object.hasOwn(internalLayers, layer)
  ) {
    return "unregistered context or layer";
  }
  if (!dependency.startsWith(".")) {
    if (
      file ===
        "memory/infrastructure/persistence/durable-object/migrate-memory.ts" &&
      dependency === "durable-utils/sql-migrations"
    )
      return;
    if (
      layer === "delivery" &&
      ["@modelcontextprotocol/server", "zod"].includes(dependency)
    )
      return;
    return "external dependency in an inner layer or unregistered adapter";
  }
  const target = relative(
    sourceRoot,
    resolve(sourceRoot, dirname(file), dependency),
  )
    .split(sep)
    .join("/");
  const [targetContext, targetLayer] = target.split("/");
  if (
    file.startsWith("memory/infrastructure/persistence/sqlite/") &&
    target.startsWith("memory/infrastructure/") &&
    !target.startsWith("memory/infrastructure/persistence/sqlite/")
  )
    return "SQLite must not depend on a runtime adapter";
  if (targetContext !== context)
    return "cross-context dependency outside an explicit integration";
  if (
    targetLayer === undefined ||
    !internalLayers[layer]!.includes(targetLayer)
  ) {
    return "dependency points outside the allowed layers";
  }
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    assert(!entry.isSymbolicLink(), "source files must not be symlinks");
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });
}

test("production imports respect context ownership and inward dependencies", () => {
  const failures: string[] = [];
  for (const path of sourceFiles(sourceRoot)) {
    const file = relative(sourceRoot, path).split(sep).join("/");
    const source = ts.createSourceFile(
      file,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
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
        failures.push(
          `${file}: runtime imports are not allowed in this service`,
        );
      }
      if (dependency !== undefined) {
        const reason = violation(file, dependency);
        if (reason) failures.push(`${file} -> ${dependency}: ${reason}`);
      }
      ts.forEachChild(node, inspect);
    };
    inspect(source);
  }
  assert.deepEqual(failures, []);
});

test("the boundary guard rejects SDK leakage, reversed dependencies, and foreign domains", () => {
  for (const [file, dependency] of [
    ["memory/domain/memory.ts", "@modelcontextprotocol/server"],
    ["memory/inboundport/commit-memory.ts", "../domain/memory-revision"],
    ["memory/outboundport/revision-store.ts", "../inboundport/inspect-memory"],
    [
      "memory/infrastructure/request-fingerprint.ts",
      "durable-utils/sql-migrations",
    ],
    ["memory/application/remember.ts", "../infrastructure/sqlite"],
    ["memory/delivery/mcp.ts", "../application/remember"],
    ["memory/inboundport/recall.ts", "cloudflare:workers"],
    ["memory/application/recall.ts", "../../identity/domain/owner"],
    ["memory/application/recall.ts", "@/memory/infrastructure/sqlite"],
    ["memory/domain/memory.ts", "../infrastructure/sqlite-memory-store"],
    [
      "memory/infrastructure/sqlite-memory-store.ts",
      "../application/commit-memory",
    ],
    ["index.ts", "./memory/infrastructure/sqlite-memory-store"],
    [
      "memory/infrastructure/persistence/sqlite/session.ts",
      "../durable-object/session",
    ],
    [
      "memory/infrastructure/persistence/sqlite/migrate-memory.ts",
      "durable-utils/sql-migrations",
    ],
  ] as const) {
    assert(
      violation(file, dependency),
      `${file} must not import ${dependency}`,
    );
  }
  assert.equal(
    violation("memory/application/recall.ts", "../inboundport/recall"),
    undefined,
  );
  assert.equal(
    violation("memory/delivery/mcp.ts", "@modelcontextprotocol/server"),
    undefined,
  );
  assert.equal(
    violation(
      "memory/infrastructure/persistence/durable-object/unit-of-work.ts",
      "../sqlite/revision-store",
    ),
    undefined,
  );
});

function responsibilityViolations(file: string, text: string): string[] {
  const failures: string[] = [];
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const layer = file.split("/")[1];
  const generatedSql =
    file === "memory/infrastructure/persistence/sqlite/migrations/generated.ts";
  const sqlite = file.startsWith("memory/infrastructure/persistence/sqlite/");
  const inner = [
    "domain",
    "application",
    "inboundport",
    "outboundport",
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
        !sqlite &&
        /\b(?:SELECT\s+.+\s+FROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i.test(
          node.text,
        )
      )
        failures.push("SQL outside SQLite adapter");
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
    ["memory/domain/x.ts", "const now = Date.now();"],
    ["memory/application/x.ts", "let storage: DurableObjectStorage;"],
    [
      "memory/infrastructure/persistence/sqlite/x.ts",
      "const sql = `CREATE TABLE hidden (id INTEGER)`;",
    ],
    ["bootstrap/x.ts", "if (owner) save();"],
    ["memory/application/x.ts", "const sql = 'SELECT * FROM revisions';"],
    [
      "memory/infrastructure/persistence/sqlite/x.ts",
      "let storage: DurableObjectStorage;",
    ],
    [
      "memory/infrastructure/persistence/sqlite/x.ts",
      "type Value = SqlStorageValue;",
    ],
    [
      "memory/infrastructure/persistence/durable-object/x.ts",
      "const sql = 'SELECT * FROM state';",
    ],
  ])
    assert(responsibilityViolations(file!, text!).length > 0, file);
});

test("SQLite compiles without Cloudflare or other runtime declarations", () => {
  const program = ts.createProgram(
    sourceFiles(
      resolve(sourceRoot, "memory/infrastructure/persistence/sqlite"),
    ),
    {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      lib: ["lib.es2022.d.ts"],
      types: [],
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

test("authored TypeScript modules expose at most one public callable", () => {
  const appRoot = resolve(sourceRoot, "..");
  const files = [
    sourceRoot,
    resolve(appRoot, "tests"),
    resolve(appRoot, "scripts"),
  ].flatMap(sourceFiles);
  const program = ts.createProgram(files, {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
  });
  const checker = program.getTypeChecker();
  for (const path of files) {
    const source = program.getSourceFile(path)!;
    const module = checker.getSymbolAtLocation(source);
    if (!module) continue;
    const callables = checker.getExportsOfModule(module).filter((symbol) => {
      const target =
        symbol.flags & ts.SymbolFlags.Alias
          ? checker.getAliasedSymbol(symbol)
          : symbol;
      const declaration = target.valueDeclaration;
      return (
        declaration &&
        checker
          .getTypeOfSymbolAtLocation(target, declaration)
          .getCallSignatures().length > 0
      );
    });
    assert(
      callables.length <= 1,
      `${relative(appRoot, path)} exports ${callables.map((symbol) => symbol.name).join(", ")}`,
    );
  }
});
