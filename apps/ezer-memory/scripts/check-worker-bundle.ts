import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const map = JSON.parse(
  readFileSync(new URL("../dist/index.js.map", import.meta.url), "utf8"),
) as { sources: string[] };
const forbidden =
  /(?:node-pg-migrate|postgrator|\/pg\/|\/pg@|\/persistence\/(?:sqlite|postgresql)\/|migrate-(?:sqlite|postgresql)|generate-migrations)/;
assert(map.sources.length > 0, "Worker source map must list its inputs");
assert.deepEqual(
  map.sources.filter((source) => forbidden.test(source)),
  [],
  "Node migration tools must not enter the Worker bundle",
);
console.log(
  "Worker bundle excludes standalone database drivers and migration tools.",
);
