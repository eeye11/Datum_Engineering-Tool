// Lists CSS selectors that can no longer match: ids and attribute selectors
// whose names appear neither in index.html nor anywhere in src/*.js.
//   node tools/refactor/css-selector-audit.mjs
import fs from "fs";
import path from "path";

const stylesDir = "src/styles";
/* Every stylesheet, including the editor's parts in styles/editor/. */
const css = fs.readdirSync(stylesDir, { recursive: true })
    .filter(f => f.endsWith(".css"))
    .map(f => fs.readFileSync(path.join(stylesDir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, ""))
    .join("\n");

const code = [];
(function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".js")) code.push(fs.readFileSync(full, "utf8"));
    }
})("src");
const haystack = fs.readFileSync("index.html", "utf8") + "\n" + code.join("\n");

const selectors = css.split("{").map(part => part.split("}").pop()).join(",");
const ids = new Set([...selectors.matchAll(/#([A-Za-z][\w-]*)/g)].map(m => m[1]));
const attributes = new Set([...selectors.matchAll(/\[([a-z][\w-]*)/g)].map(m => m[1]));

const missingIds = [...ids].filter(id => !haystack.includes(id));
const missingAttributes = [...attributes].filter(a => !haystack.includes(a));

console.log("ids with nothing to match:", missingIds.join(", ") || "none");
console.log("attributes with nothing to match:", missingAttributes.join(", ") || "none");
process.exitCode = missingIds.length || missingAttributes.length ? 1 : 0;
