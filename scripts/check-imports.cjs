const fs = require("fs");
const path = require("path");

const root = "src";
const files = [];

(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(js|mjs)$/.test(e.name)) files.push(p);
  }
})(root);

function resolveExt(base) {
  for (const c of [
    base,
    base + ".js",
    base + ".mjs",
    path.join(base, "index.js"),
  ]) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

let broken = 0;
let checked = 0;

for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  const re =
    /(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    const spec = m[1] || m[2] || m[3];
    if (!spec || !spec.startsWith(".")) continue;
    checked++;
    const abs = path.resolve(path.dirname(f), spec);
    if (!resolveExt(abs)) {
      broken++;
      console.log("BROKEN", f, "->", spec);
    }
  }
}

console.log("relative imports checked:", checked, " broken:", broken);
