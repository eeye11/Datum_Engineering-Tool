/*
 * Compile every picture in a DAETUM .tex with a real TeX engine.
 *
 *   node tools/dev/compile-latex.mjs <file.tex> [--svg <out-dir>]
 *
 * A VERIFICATION HARNESS, not part of the application: DAETUM writes and reads
 * its LaTeX with its own code and never runs TeX. This uses node-tikzjax (TeX
 * and PGF/TikZ compiled to WebAssembly, already a dependency of the optional
 * server) to prove that what DAETUM writes is valid LaTeX that compiles.
 *
 * Each tikzpicture is compiled on its own, with the file's colour
 * definitions. Exit code 1 if any picture fails.
 */
import fs from "fs";
import path from "path";

const [file, flag, outDir] = process.argv.slice(2);

if (!file) {
    console.error("usage: node tools/dev/compile-latex.mjs <file.tex> [--svg <out-dir>]");
    process.exit(2);
}

const source = fs.readFileSync(file, "utf8");
/* The file's own preamble additions: packages, colours, character declarations. */
const preamble = source.slice(source.indexOf("\\documentclass"), source.indexOf("\\begin{document}"))
    .split(/\r?\n/)
    .filter(line => line && !/^\\documentclass|^\\usepackage\[T1\]\{fontenc\}|^\\renewcommand\{\\familydefault\}/.test(line));
const pictures = [...source.matchAll(/\\begin\{tikzpicture\}[\s\S]*?\\end\{tikzpicture\}/g)].map(m => m[0]);

const tikzjax = await import("node-tikzjax");
await tikzjax.load();

if (flag === "--svg" && outDir) {
    fs.mkdirSync(outDir, { recursive: true });
}

let failed = 0;

for (const [index, picture] of pictures.entries()) {
    const document = [
        "\\usepackage{tikz}",
        ...preamble,
        "\\begin{document}",
        picture,
        "\\end{document}"
    ].join("\n");

    try {
        const dvi = await tikzjax.tex(document, { showConsole: false });
        const svg = await tikzjax.dvi2svg(dvi);

        if (flag === "--svg" && outDir) {
            fs.writeFileSync(path.join(outDir, `picture-${String(index + 1).padStart(3, "0")}.svg`), svg);
        }
    } catch (error) {
        failed++;
        console.log(`✗ picture ${index + 1}: ${String(error?.message || error).split("\n").slice(0, 3).join(" | ")}`);
    }
}

console.log(`${pictures.length - failed}/${pictures.length} pictures compiled`);
process.exit(failed ? 1 : 0);
