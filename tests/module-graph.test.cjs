/*
 * ========================================================
 * THE APPLICATION BOOTS
 * ========================================================
 *
 * A single wrong re-export - `export { default as X } from "./module.js"` for a
 * module that has only NAMED exports - throws at module-evaluation time. The
 * page still loads, the tab bar still renders from the HTML, and NOTHING works:
 * no editor, no canvas, no Engineering Drawing tab. It looks like the UI is
 * broken rather than like a build error, which is why it is worth pinning.
 *
 * This walks the editor's own barrel file and checks that every module it
 * re-exports a DEFAULT from actually HAS a default export, and that every
 * namespace re-export points at a module that exists.
 */

const fs = require("fs");
const path = require("path");

const { locate } = require("./helpers/source-path.cjs");

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

const projectRoot = path.join(__dirname, "..");

/* Every source module under src/, by absolute path. */
function walk(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walk(full, found);
    } else if (entry.name.endsWith(".js")) {
      found.push(full);
    }
  }

  return found;
}

const modules = walk(path.join(projectRoot, "src"));

function hasDefaultExport(file) {
  const source = fs.readFileSync(file, "utf8");

  return (
    /^\s*export default\b/m.test(source) ||
    /^\s*export\s*\{[^}]*\bdefault\b[^}]*\}/m.test(source)
  );
}

console.log("\n  re-exports resolve to something that exists\n");

/*
 * Every `export ... from "..."` and `import ... from "..."` in the source tree
 * must point at a file that exists, and a `default` re-export must point at a
 * module that actually exports one.
 */
let missingTargets = [];
let missingDefaults = [];

modules.forEach((file) => {
  const source = fs.readFileSync(file, "utf8");

  const reExports = source.matchAll(
    /export\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g,
  );

  for (const match of reExports) {
    const names = match[1];
    const specifier = match[2];

    const target = path.resolve(path.dirname(file), specifier);

    if (!fs.existsSync(target)) {
      missingTargets.push(`${file} -> ${specifier}`);
      continue;
    }

    /* `export { default as X }` needs the target to HAVE a default. */
    if (/\bdefault\b/.test(names) && !hasDefaultExport(target)) {
      missingDefaults.push(
        `${path.basename(file)}: ${match[0].replace(/\s+/g, " ")}`,
      );
    }
  }

  const namespaceExports = source.matchAll(
    /export\s*\*\s*as\s*\w+\s*from\s*["']([^"']+)["']/g,
  );

  for (const match of namespaceExports) {
    const target = path.resolve(path.dirname(file), match[1]);

    if (!fs.existsSync(target)) {
      missingTargets.push(`${file} -> ${match[1]}`);
    }
  }
});

check(
  "every re-export points at a module that exists",
  missingTargets.length === 0,
  missingTargets.join("\n       "),
);

check(
  "no default is re-exported from a module that has only named exports",
  missingDefaults.length === 0,
  missingDefaults.join("\n       "),
);

/*
 * THE EDITOR'S BARREL IS THE ONE THE ENTRY POINT PULLS FROM.
 *
 * A fault here stops the whole application, so its exports are checked by name.
 */
console.log("\n  the editor barrel exports what the app needs\n");

const barrel = fs.readFileSync(locate("features/workspace/index.js"), "utf8");

["enggDrawing", "enggDrawingSheets", "enggTransforms"].forEach((name) => {
  check(
    `editor/index.js exports ${name}`,
    new RegExp(`\\b${name}\\b`).test(barrel),
  );
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
