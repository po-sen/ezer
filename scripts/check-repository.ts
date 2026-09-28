import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

function runNode(args: string[]): void {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Reject unsafe paths before passing any tracked file to the formatter.
runNode([join(root, "scripts/check-staged-paths.ts")]);

const files = execFileSync("git", ["ls-files", "--cached", "-z"], {
  encoding: "utf8",
  cwd: root,
})
  .split("\0")
  .filter((path) =>
    /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|json|jsonc|md|mdx|yml|yaml)$/.test(
      path,
    ),
  );

const prettier = fileURLToPath(
  import.meta.resolve("prettier/bin/prettier.cjs"),
);

// Bound argument lengths and preserve filenames containing spaces.
for (let offset = 0; offset < files.length; offset += 100) {
  runNode([
    prettier,
    "--check",
    "--config",
    ".prettierrc.json",
    "--ignore-path",
    ".gitignore",
    "--",
    ...files.slice(offset, offset + 100).map((path) => `./${path}`),
  ]);
}

console.log(
  `Repository checks passed (${files.length} formatting candidates).`,
);
