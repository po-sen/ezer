import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
const internalLayers: Record<string, readonly string[]> = {
  domain: ["domain"],
  inboundport: ["domain", "inboundport"],
  outboundport: ["domain", "outboundport"],
  application: ["domain", "inboundport", "outboundport", "application"],
  infrastructure: ["domain", "outboundport", "infrastructure"],
  delivery: ["inboundport", "delivery"],
};

function violation(file: string, dependency: string): string | undefined {
  const [context, layer] = file.split("/");
  if (context === "bootstrap") return;
  if (file === "index.ts") {
    return dependency === "./bootstrap/worker"
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
    ["memory/application/remember.ts", "../infrastructure/sqlite"],
    ["memory/delivery/mcp.ts", "../application/remember"],
    ["memory/inboundport/recall.ts", "cloudflare:workers"],
    ["memory/application/recall.ts", "../../identity/domain/owner"],
    ["memory/application/recall.ts", "@/memory/infrastructure/sqlite"],
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
});
