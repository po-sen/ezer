import { build } from "esbuild";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  copyFileSync,
  existsSync,
  realpathSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const output = new URL("dist/local/", root);
const result = await build({
  entryPoints: [fileURLToPath(new URL("src/entrypoints/local.ts", root))],
  outfile: fileURLToPath(new URL("entrypoints/local.mjs", output)),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24.5",
  sourcemap: true,
  metafile: true,
  banner: {
    js: 'import { createRequire as __ezerCreateRequire } from "node:module"; const require = __ezerCreateRequire(import.meta.url);',
  },
});
if (
  Object.keys(result.metafile!.inputs).some((path) =>
    /(?:cloudflare|durable-object|node-pg-migrate|\/pg\/)/.test(path),
  )
)
  throw new Error("Cloud runtime dependency in local bundle");
const files = [
  "THIRD_PARTY_NOTICES.txt",
  "entrypoints/local.mjs",
  "entrypoints/local.mjs.map",
];
for (const context of ["memory", "workspace"]) {
  const relative = `modules/${context}/infrastructure/persistence/sqlite/migrations/`;
  const source = new URL(`src/${relative}`, root);
  const target = new URL(relative, output);
  mkdirSync(target, { recursive: true });
  const migrations = readdirSync(source).filter(
    (file) => file.endsWith(".sql") || file === "checksums.json",
  );
  for (const file of migrations) {
    copyFileSync(new URL(file, source), new URL(file, target));
    files.push(relative + file);
  }
}
const packages = new Set<string>();
for (const input of Object.keys(result.metafile!.inputs).filter((path) =>
  path.includes("node_modules/"),
)) {
  let directory = dirname(realpathSync(resolve(input)));
  while (!existsSync(join(directory, "package.json"))) {
    const parent = dirname(directory);
    if (parent === directory)
      throw new Error("Bundled dependency metadata missing");
    directory = parent;
  }
  // Some packages have nested ESM/CJS metadata; licenses belong to the package root.
  while (
    !JSON.parse(readFileSync(join(directory, "package.json"), "utf8")).name
  ) {
    directory = dirname(directory);
    while (!existsSync(join(directory, "package.json")))
      directory = dirname(directory);
  }
  packages.add(directory);
}
// The packager copies only this reviewed build output, never source data or node_modules.
writeFileSync(
  new URL("manifest.json", output),
  JSON.stringify({ files }, null, 2) + "\n",
);
writeFileSync(
  new URL("THIRD_PARTY_NOTICES.txt", output),
  [
    "Bundled runtime dependencies are distributed under their upstream licenses.",
    ...[...packages].sort().map((directory) => {
      const metadata = JSON.parse(
        readFileSync(join(directory, "package.json"), "utf8"),
      );
      const license = readdirSync(directory).find((file) =>
        /^licen[cs]e(?:\.|$)/i.test(file),
      );
      if (!license) throw new Error("Bundled dependency license missing");
      return `${metadata.name}@${metadata.version}\n${readFileSync(join(directory, license), "utf8")}`;
    }),
  ].join("\n\n"),
);
console.log(
  "Built local Ezer without Cloudflare or PostgreSQL runtime dependencies.",
);
