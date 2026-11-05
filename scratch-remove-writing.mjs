import fs from "fs";

const path = "index.html";
const lines = fs.readFileSync(path, "utf8").split("\n");

/*
 * Remove the Written Solution block by its own boundaries.
 *
 * FROM the comment banner that introduces it, TO the </section> that closes it -
 * both located by content, and asserted before anything is written, so a wrong
 * guess cannot destroy the drawing workspace next door.
 */
const bannerLine = lines.findIndex((line) => /WRITTEN SOLUTION WORKSPACE/.test(line));
const sectionLine = lines.findIndex((line) => line.trim() === 'id="writing"');

if (bannerLine < 0 || sectionLine < 0) {
  console.error(`NOT FOUND banner=${bannerLine} section=${sectionLine}`);
  process.exit(1);
}

const from = lines[bannerLine - 1].trim().startsWith("<!-- =====") ? bannerLine - 1 : bannerLine;
const to = lines.findIndex((line, index) => index > sectionLine && line.trim() === "</section>");

if (to < 0) {
  console.error("closing </section> not found");
  process.exit(1);
}

const block = lines.slice(from, to + 1).join("\n");

if (!block.includes("solutionWorkspace") || block.includes('id="drawing"')) {
  console.error("refusing: the range is not the Written Solution block");
  process.exit(1);
}

lines.splice(from, to - from + 1);

fs.writeFileSync(path, lines.join("\n"));

console.log(`removed lines ${from + 1}-${to + 1} (${block.length} characters)`);
