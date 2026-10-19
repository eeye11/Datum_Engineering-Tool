/*
 * ========================================================
 * THE WRITTEN SOLUTION'S OUTLINE, PARSED FROM ITS SOURCE
 * ========================================================
 *
 * The workspace shows THREE views of one document: the outline, the editor and
 * the preview. There is one source, and the outline is DERIVED from it - so the
 * parsing is the part worth pinning, because a wrong parse is an outline that
 * disagrees with the text beside it.
 *
 * These check the three things that make the outline usable:
 *
 *   the HIERARCHY   a subsection is one level in, under its section
 *   the NUMBERING   sections number 1, 1.1, 1.2, 2 - and problems are their own
 *                   series, so a problem does not push the first section to "2"
 *   the LINE        every row knows which line to jump to
 */

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

const solution = require(locate("src/shared/solution/solution-state.js"));

console.log("\n  the outline is built from the source\n");

const source = [
  "\\section{Introduction}",
  "Some prose.",
  "\\begin{problem}",
  "Find the reaction at A.",
  "\\end{problem}",
  "\\subsection{Equilibrium}",
  "\\[ \\sum M_B = 0 \\]",
  "\\subsubsection{Moments}",
  "\\section{Method}",
  ""
].join("\n");

const headings = solution.parseStructure(source);

/*
 * FIVE headings: section, problem, subsection, subsubsection, section. The
 * prose, the display maths and the \end{problem} are not headings, and are the
 * ones a naive line-based parse would get wrong.
 */
check("every heading is found, and nothing else", headings.length === 5, `found ${headings.length}`);

check(
  "the hierarchy is read from the command, not guessed",
  headings.map((h) => h.level).join(",") === "0,0,1,2,0",
  headings.map((h) => `${h.label}:${h.level}`).join(" | "),
);

check(
  "and titles lose their braces",
  headings[0].title === "Introduction" && headings[2].title === "Equilibrium",
  headings.map((h) => h.title).join(" | "),
);

console.log("\n  the numbering\n");

check(
  "sections number by depth, and a new section resets the deeper counters",
  headings[0].number === "1" &&
    headings[2].number === "1.1" &&
    headings[3].number === "1.1.1" &&
    headings[4].number === "2",
  headings.map((h) => h.number).join(","),
);

check(
  "a problem is its own series, so it does not renumber the sections",
  headings[1].isProblem === true && headings[1].number === "P1",
  `${headings[1].label} ${headings[1].number}`,
);

check(
  "the problem is a TOP-LEVEL entry, where a student would look for it",
  headings[1].level === 0,
);

console.log("\n  and every row knows where to go\n");

check(
  "each heading carries its line",
  headings[0].line === 0 && headings[4].line === 8,
  headings.map((h) => h.line).join(","),
);

check(
  "lines are ascending, as the outline reads",
  headings.every((h, i) => i === 0 || h.line >= headings[i - 1].line),
);

console.log("\n  figures and equations are listed too\n");

const withFigures = "\\section{A}\n\\datumfigure{abc}\n\\[ x = 1 \\]\n\\datumfigure{def}\n";

const figures = solution.parseFigures(withFigures);
const equations = solution.parseEquations(withFigures);

check("both figures are found", figures.length === 2, String(figures.length));
check(
  "and they are the DRAWING kind - a live link to a sheet",
  figures.every((f) => f.kind === "drawing"),
);

check("the display equation is found", equations.length === 1, String(equations.length));

check(
  "an INLINE equation is not listed, because it is part of a sentence",
  solution.parseEquations("The value $F = ma$ holds.").length === 0,
);

console.log("\n  the source is the one state\n");

solution.setSource("\\section{One}");
check("setSource stores it", solution.getSource() === "\\section{One}");

check(
  "and re-setting the SAME text reports no change",
  solution.setSource("\\section{One}") === false,
  "a keystroke that produced no change should not schedule a recompile",
);

check(
  "while a real change reports one",
  solution.setSource("\\section{Two}") === true,
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
