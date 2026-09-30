import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { relative, resolve, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const options: ts.CompilerOptions = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowImportingTsExtensions: true,
  noEmit: true,
  skipLibCheck: true,
};

function exportViolation(
  program: ts.Program,
  path: string,
): string | undefined {
  const file = relative(repositoryRoot, path).split(sep).join("/");
  if (
    file === "apps/ezer-memory/worker-configuration.d.ts" ||
    file.startsWith("apps/ezer-memory/src/bootstrap/") ||
    file.startsWith("apps/ezer-memory/src/entrypoints/")
  )
    return;
  const source = program.getSourceFile(path);
  assert(source, `Missing source: ${file}`);
  const checker = program.getTypeChecker();
  const module = checker.getSymbolAtLocation(source);
  const exports = module ? checker.getExportsOfModule(module) : [];
  if (exports.length > 1)
    return `${file} exports ${exports.map((symbol) => symbol.name).join(", ")}`;
}

test("all tracked TypeScript files respect the single-export rule", () => {
  // Validate indexed paths and symlinks before reading any repository source.
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
    .filter(Boolean)
    .map((path) => resolve(repositoryRoot, path));
  const program = ts.createProgram(paths, options);
  const failures = paths
    .map((path) => exportViolation(program, path))
    .filter(Boolean);
  assert.deepEqual(failures, []);
});

test("the export guard counts types, values, aliases, defaults, and re-exports", () => {
  const cases: [string, string, boolean][] = [
    [
      "functions.ts",
      "export function a() {} export const b = () => {};",
      false,
    ],
    ["types.ts", "export type A = string; export interface B {}", false],
    ["mixed.ts", "export function a() {} export interface B {}", false],
    ["constants.ts", "export const a = 1, b = 2;", false],
    ["default.ts", "export default {}; export class B {}", false],
    ["aliases.ts", "const a = 1; export { a, a as b };", false],
    ["reexport.ts", 'export { A, B } from "./dependency.ts";', false],
    ["star.ts", 'export * from "./dependency.ts";', false],
    ["type-star.ts", 'export type * from "./dependency.ts";', false],
    ["one-reexport.ts", 'export { A } from "./dependency.ts";', true],
    ["one-type.ts", "export interface A {}", true],
    ["one-class.ts", "export class A { first() {} second() {} }", true],
    [
      "overloads.ts",
      "export function a(x: string): string; export function a(x: number): number; export function a(x: string | number) { return x; }",
      true,
    ],
    ["private.ts", "function a() {} function b() {} export {};", true],
    ["authored.d.ts", "export interface A {} export interface B {}", false],
  ];
  const fixtureRoot = resolve(repositoryRoot, "apps/ezer-memory/tests");
  const sources = new Map(
    cases.map(([file, source]) => [resolve(fixtureRoot, file), source]),
  );
  sources.set(
    resolve(fixtureRoot, "dependency.ts"),
    "export interface A {} export interface B {}",
  );
  const exceptionCases: [string, boolean][] = [
    ["apps/ezer-memory/src/bootstrap/example.ts", true],
    ["apps/ezer-memory/src/entrypoints/example.ts", true],
    ["apps/ezer-memory/worker-configuration.d.ts", true],
    ["apps/ezer-memory/src/modules/memory/bootstrap/example.ts", false],
    [
      "apps/ezer-memory/src/modules/memory/infrastructure/persistence/sqlite/migrations/migrations.generated.ts",
      false,
    ],
    ["apps/ezer-memory/vitest.config.ts", false],
    ["scripts/example.ts", false],
  ];
  for (const [file] of exceptionCases)
    sources.set(
      resolve(repositoryRoot, file),
      "export const a = 1; export const b = 2;",
    );
  const host = ts.createCompilerHost(options);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  const originalFileExists = host.fileExists.bind(host);
  host.fileExists = (path) => sources.has(path) || originalFileExists(path);
  host.getSourceFile = (
    path,
    languageVersion,
    onError,
    shouldCreateNewSourceFile,
  ) => {
    const source = sources.get(path);
    return source === undefined
      ? originalGetSourceFile(
          path,
          languageVersion,
          onError,
          shouldCreateNewSourceFile,
        )
      : ts.createSourceFile(path, source, languageVersion, true);
  };
  const program = ts.createProgram([...sources.keys()], options, host);
  for (const [file, , valid] of cases)
    assert.equal(
      exportViolation(program, resolve(fixtureRoot, file)) === undefined,
      valid,
      file,
    );
  for (const [file, valid] of exceptionCases)
    assert.equal(
      exportViolation(program, resolve(repositoryRoot, file)) === undefined,
      valid,
      file,
    );
});
