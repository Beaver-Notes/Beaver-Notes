// Verifies that every entry point package.json declares actually ships in the
// tarball npm would publish.
//
// This exists because 0.1.0-beta.8 published with "types": "./dist-js/index.d.ts"
// while the declaration file had landed at dist-js/guest-js/index.d.ts. A
// TypeScript upgrade changed how tsc infers rootDir, the emit path moved, and
// nothing failed: rollup succeeded, prepublishOnly succeeded, and the broken
// package went to npm. Consumers got TS7016 with no declarations resolvable.
//
// Comparing the declared paths against the real tarball listing is the only check
// that catches this class of drift, since the build itself is perfectly happy.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cwd, exit } from "node:process";

const pkg = JSON.parse(readFileSync(join(cwd(), "package.json"), "utf8"));

// Collect every string leaf under "exports", which may nest arbitrarily deep
// (conditions like "node" > "import" > "default"), plus the legacy top-level
// fields. Keyed by path so the same file referenced twice is reported once,
// with all the field names that point at it.
function collectEntryPoints() {
  const found = new Map();

  const record = (label, value) => {
    if (typeof value !== "string" || !value.startsWith(".")) return;
    const normalized = value.replace(/^\.\//, "");
    if (!found.has(normalized)) found.set(normalized, []);
    found.get(normalized).push(label);
  };

  for (const field of [
    "types",
    "typings",
    "main",
    "module",
    "browser",
    "bin",
  ]) {
    record(field, pkg[field]);
  }

  const walkExports = (node, path) => {
    if (typeof node === "string") {
      record(path, node);
    } else if (node && typeof node === "object") {
      for (const [key, child] of Object.entries(node)) {
        walkExports(child, `${path}.${key}`);
      }
    }
  };
  walkExports(pkg.exports, "exports");

  return found;
}

// --ignore-scripts matters: npm pack fires prepack/prepublishOnly, and this
// script is itself wired into prepublishOnly. Without it the two recurse.
//
// The --json shape is not stable across npm majors, and the publish workflow
// installs npm@latest mid-job, so this can run under a newer npm than the one
// that ran it in CI:
//   npm 11: [ { id, files: [...] } ]              -- array
//   npm 12: { "<pkg-name>": { id, files: [...] } } -- object keyed by name
// Normalize both to a list of entries rather than assuming either.
function tarballContents() {
  const raw = execFileSync(
    "npm",
    ["pack", "--dry-run", "--json", "--ignore-scripts"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }
  );

  const parsed = JSON.parse(raw);
  const entries = Array.isArray(parsed) ? parsed : Object.values(parsed ?? {});

  // Fail loudly on an unrecognized shape. Returning an empty set here would
  // report every entry point as missing and read as a packaging bug, sending
  // the next person after the wrong problem.
  const files = entries.flatMap((entry) => entry?.files ?? []);
  if (entries.length === 0 || files.length === 0) {
    console.error(
      "verify-package: could not read a file list from 'npm pack --json'.\n" +
        `npm version: ${execFileSync("npm", ["--version"], { encoding: "utf8" }).trim()}\n` +
        "The output shape may have changed again. Raw output:\n"
    );
    console.error(raw);
    exit(1);
  }

  return new Set(files.map((f) => f.path));
}

const entryPoints = collectEntryPoints();
if (entryPoints.size === 0) {
  console.error(
    "verify-package: package.json declares no entry points to check"
  );
  exit(1);
}

const shipped = tarballContents();
const missing = [];

for (const [path, fields] of entryPoints) {
  if (!shipped.has(path)) missing.push({ path, fields });
}

if (missing.length > 0) {
  console.error(
    `\nverify-package: ${missing.length} declared entry point(s) are not in the tarball.\n`
  );
  for (const { path, fields } of missing) {
    console.error(`  ${path}`);
    console.error(`    declared by: ${fields.join(", ")}`);
  }
  console.error("\nFiles the tarball does contain:");
  for (const path of [...shipped].sort()) {
    console.error(`  ${path}`);
  }
  console.error(
    "\nEither the build emitted to a different path than package.json expects,\n" +
      'or "files" excludes it. Do not publish this.\n'
  );
  exit(1);
}

console.log(
  `verify-package: all ${entryPoints.size} declared entry point(s) present in tarball:`
);
for (const path of [...entryPoints.keys()].sort()) {
  console.log(`  ${path}`);
}
