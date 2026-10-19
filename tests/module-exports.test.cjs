/*
 * ========================================================
 * EVERY NAMED IMPORT RESOLVES
 * ========================================================
 *
 * THE DEFECT THIS PINS. `selection.js` imported `objectIntersectsSelection` from
 * `box-selection.js`, but that module had the function under a different name. A
 * named import of a symbol a module does not export is a SYNTAX ERROR in the
 * browser - not a runtime `undefined` - so the whole module graph failed to
 * evaluate from that point on.
 *
 * The symptom was nowhere near the cause: `app/entry/main.js` stops where it imports the
 * broken chain, so the menu bar, the command search and the drawing editor's own
 * wiring never ran, and the ENGINEERING DRAWING TAB did nothing when clicked -
 * the section never became active. No console error appeared in the app's own log,
 * because the failure happened before any of it was installed.
 *
 * A unit test could not catch it either: `require()` of an ES module in the test
 * harness resolves through a shim that tolerates a missing name, so every test
 * passed while the APPLICATION could not start. That is the gap this file closes,
 * by checking the SOURCE of every named import against the SOURCE of the module
 * it imports - the same question the browser asks, answered without a browser.
 */

const fs = require("fs");
const path = require("path");

const projectRoot = path.join(__dirname, "..");
const srcRoot = path.join(projectRoot, "src");
/* Modules are found by file name, so they can move between folders. */
const { modulePath } = require("./helpers/source-path.cjs");

let pass = 0;
let fail = 0;

const check = (name, ok, detail) => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ""}`);
  }
};

/* Every .js file under src/. */
const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      return walk(full);
    }

    return entry.name.endsWith(".js") ? [full] : [];
  });

const files = walk(srcRoot);

/*
 * WHAT A MODULE EXPORTS, read from its source.
 *
 * `export function name`, `export const name`, `export let/var name`,
 * `export class name`, `export { a, b }`, and the `export default` case are all
 * collected. It is deliberately a source scan: the failure being prevented is a
 * SOURCE-level mismatch, and a scan needs no module loading, so it works in this
 * harness and cannot itself be defeated by the very problem it looks for.
 */
function exportsOf(source) {
  const names = new Set();

  // export function name / const / let / var / class
  for (const match of source.matchAll(
    /export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g,
  )) {
    names.add(match[1]);
  }

  /*
   * export * as name from "..."
   *
   * A NAMESPACE re-export. The name IS a real export of this module - it is the
   * whole of the target module's namespace - so it satisfies any import of that
   * name. It is not a wildcard in the sense below (which spreads names rather
   * than creating one), so it is collected here rather than skipped.
   */
  for (const match of source.matchAll(
    /export\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from/g,
  )) {
    names.add(match[1]);
  }

  // export { a, b as c }
  for (const match of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of match[1].split(",")) {
      const piece = part.trim();
      if (!piece) continue;

      const aliased = /^[\w$]+\s+as\s+([A-Za-z_$][\w$]*)$/.exec(piece);
      if (aliased) {
        names.add(aliased[1]);
      } else if (/^[A-Za-z_$][\w$]*$/.test(piece)) {
        names.add(piece);
      }
    }
  }

  // A wildcard re-export means the target's names are unknowable here, so the
  // module is treated as satisfying anything rather than producing a false alarm.
  const wildcard = /export\s+\*\s+from/.test(source);

  return { names, wildcard };
}

const sourceOf = new Map(
  files.map((file) => [file, fs.readFileSync(file, "utf8")]),
);

/*
 * Resolve a relative import specifier to a file in the map.
 */
function resolveSpecifier(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [base, `${base}.js`, path.join(base, "index.js")];

  return candidates.find((candidate) => sourceOf.has(candidate)) || null;
}

const broken = [];

for (const [file, source] of sourceOf) {
  /*
   * Only NAMED imports are checked. A default import (`import x from`) cannot
   * name a symbol that might be absent, and a bare import (`import "./x.js"`) has
   * no name to check.
   */
  const importPattern =
    /import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;

  for (const match of source.matchAll(importPattern)) {
    const [, clause, specifier] = match;

    // Only relative imports resolve to a file we can read.
    if (!specifier.startsWith(".")) {
      continue;
    }

    const target = resolveSpecifier(file, specifier);

    if (!target) {
      continue; // A path we cannot resolve is not what this test is about.
    }

    const { names, wildcard } = exportsOf(sourceOf.get(target));

    if (wildcard) {
      continue;
    }

    for (const part of clause.split(",")) {
      const piece = part.trim();
      if (!piece) continue;

      // `name as alias` - the ORIGINAL name is what must be exported.
      const aliased = /^([A-Za-z_$][\w$]*)\s+as\s+[A-Za-z_$][\w$]*$/.exec(piece);
      const imported = aliased ? aliased[1] : piece;

      if (!/^[A-Za-z_$][\w$]*$/.test(imported)) {
        continue;
      }

      if (!names.has(imported)) {
        broken.push(
          `${path.relative(projectRoot, file)} imports { ${imported} } from "${specifier}" - not exported by ${path.relative(projectRoot, target)}`,
        );
      }
    }
  }
}

check(
  "every named import resolves to an export",
  broken.length === 0,
  broken.length
    ? `${broken.length} unresolvable import(s):\n       ${broken.join("\n       ")}`
    : undefined,
);

/*
 * AND THE SPECIFIC ONE THAT BROKE, asserted by name so a regression is reported
 * as what it is rather than as a generic count.
 */
const boxSource = sourceOf.get(modulePath("box-selection.js"));

check(
  "box-selection exports the dispatcher selection.js imports",
  Boolean(boxSource) &&
    /export\s+(?:async\s+)?function\s+objectIntersectsSelection\b/.test(boxSource),
  "selection.js imports objectIntersectsSelection, which must be exported",
);

check(
  "and keeps the previous name as an alias",
  Boolean(boxSource) &&
    /export\s+const\s+coordinateSystemIntersectsSelection\b/.test(boxSource),
  "the old name should still resolve for existing callers",
);

/*
 * THE IMPORT SIDE TOO. If selection.js stops importing it, this test should say
 * so rather than quietly passing because nothing asks for it.
 */
const selectionSource = sourceOf.get(
  modulePath("selection.js"),
);

check(
  "selection.js still imports the dispatcher it needs",
  Boolean(selectionSource) &&
    /objectIntersectsSelection/.test(selectionSource),
  "selection.js no longer imports objectIntersectsSelection",
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
