/*
 * ========================================================
 * THE PRODUCT IS DAETUM, AND THE API IS STILL `datum`
 * ========================================================
 *
 * The rename from the former product name to DAETUM is a BRANDING change, not a
 * rebuild. Two things therefore have to hold at once, and this test pins both:
 *
 *   1. no file in the shipped source names the product by its FORMER name -
 *      not in a comment, not in a dialog, not in a console line, not in the
 *      window title;
 *
 *   2. the TECHNICAL identifiers that still say `datum` are ALL still there.
 *      `window.datum`, the `datum:` postMessage protocol, the `datum-*` class
 *      hooks and the `datum:*` storage keys are contracts - a host page, a
 *      saved theme and an embedded integration depend on them, and renaming
 *      them would break compatibility for no gain.
 *
 * So the check is deliberately two-sided: the old PRODUCT NAME must be gone,
 * and the old TECHNICAL NAME must remain.
 */

const fs = require("fs");
const path = require("path");

const { SOURCE_ROOT, locate } = require("./helpers/source-path.cjs");

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

/* Every shipped source file, by absolute path. */
function walk(dir, found = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            if (entry.name === "node_modules" || entry.name === "dist") continue;
            walk(full, found);
        } else if (/\.(js|css|html)$/.test(entry.name)) {
            found.push(full);
        }
    }

    return found;
}

const sources = walk(SOURCE_ROOT);

/*
 * A LINE NAMES THE PRODUCT when it contains the word "Datum" as a word, and it
 * is NOT one of the technical identifiers below. The identifier list is the
 * whole reason this is a line filter rather than a substring replace.
 */
const TECHNICAL = [
    "window.datum",
    "createDatumApi",
    "onDatumEvent",
    "emitDatumEvent",
    "DATUM_EVENTS",
    "datum-",
    "datum:",
    "datum.",
    "datum)",
    "datum_",
    ".datum",
];

/*
 * THE GD&T SYMBOL IS A MATHEMATICAL TERM, NOT THE PRODUCT.
 *
 * A "datum" is a reference plane in geometric dimensioning and tolerancing, and
 * the symbol library's two entries for it are labelled with that word. Writing
 * DAETUM there would make the annotate tool WRONG rather than make the
 * application consistently named, so these exact lines are allowed.
 */
const GDANDT_LINES = /label: "Datum"|label: "Datum \/ GD&T"/;

const namesProduct = (line) => {
    if (!/\bDatum\b/.test(line)) {
        return false;
    }

    if (GDANDT_LINES.test(line)) {
        return false;
    }

    return !TECHNICAL.some((token) => line.includes(token));
};

console.log("\n  no source file names the product by its FORMER name\n");

const offenders = [];

sources.forEach((file) => {
    fs.readFileSync(file, "utf8")
        .split(/\r?\n/)
        .forEach((line, index) => {
            if (namesProduct(line)) {
                offenders.push(
                    `${path.relative(projectRoot, file)}:${index + 1}: ${line.trim()}`,
                );
            }
        });
});

check(
    "the product's former name appears nowhere in the shipped source",
    offenders.length === 0,
    offenders.slice(0, 12).join("\n       "),
);

console.log("\n  and the product IS named DAETUM where it identifies itself\n");

const identity = fs.readFileSync(locate("app-identity.js"), "utf8");
const html = fs.readFileSync(path.join(projectRoot, "index.html"), "utf8");
const pkg = JSON.parse(
    fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"),
);

check(
    "there is ONE shared application-name constant",
    /export const APP_NAME = "DAETUM"/.test(identity),
    "a component that names the product imports it rather than retyping it",
);

check(
    "the browser tab and the wordmark read DAETUM",
    /<title>DAETUM<\/title>/.test(html) &&
        /header-wordmark[\s\S]{0,80}DAETUM/.test(html),
);

check(
    "the About entry names DAETUM",
    /label: "About DAETUM"/.test(
        fs.readFileSync(locate("menu-commands.js"), "utf8"),
    ),
);

check(
    "and the package metadata names DAETUM",
    pkg.description.startsWith("DAETUM"),
    pkg.description,
);

check(
    "the window title stays DAETUM",
    /document\.title = "DAETUM"/.test(fs.readFileSync(locate("document-commands.js"), "utf8")),
);

console.log("\n  while the TECHNICAL identifiers still say datum\n");

const api = fs.readFileSync(locate("datum-api.js"), "utf8");
const embed = fs.readFileSync(locate("embed-bridge.js"), "utf8");
const theme = fs.readFileSync(locate("theme.js"), "utf8");

check(
    "the integration API object is still window.datum",
    /window\.datum/.test(fs.readFileSync(locate("app/entry/main.js"), "utf8")),
    "a host page scripts this name; renaming it breaks every integration",
);

check(
    "the postMessage protocol is still datum:*",
    /datum:request/.test(embed) || /datum:/.test(embed),
);

check(
    "the theme preference is still stored under its own key",
    /"datum\.theme"/.test(theme),
    "renaming the key would silently drop every saved theme",
);

check(
    "the drawing symbol keeps its own id",
    /\{ id: "datum", label: "Datum"/.test(
        fs.readFileSync(locate("annotate-model.js"), "utf8"),
    ),
    "a GD&T datum symbol is a mathematical term, not the product",
);

check(
    "the API module still exports its documented surface",
    /export default|enggDatumApi|createDatumApi/.test(api),
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
