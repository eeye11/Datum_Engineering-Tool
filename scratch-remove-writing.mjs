import fs from "fs";

const path = "index.html";
let source = fs.readFileSync(path, "utf8");

/*
 * Remove the Written Solution section, from its own comment banner to the
 * closing </section> that ends it.
 *
 * The section is located by its id rather than by a line count, so the removal
 * survives any later edit above it.
 */
const sectionStart = source.indexOf('<section\n            id="writing"');

if (sectionStart < 0) {
  console.error("writing section not found");
  process.exit(1);
}

/* The comment banner immediately above it goes too. */
const commentStart = source.lastIndexOf(
  "<!-- =================================================",
  sectionStart,
);
const from =
  commentStart >= 0 && commentStart > sectionStart - 900
    ? commentStart
    : sectionStart;

const marker = "</section>";
let cursor = sectionStart;
let depth = 0;

/* Find the section's own closing tag, counting nested sections. */
while (cursor < source.length) {
  const open = source.indexOf("<section", cursor);
  const close = source.indexOf(marker, cursor);

  if (close < 0) {
    break;
  }

  if (open >= 0 && open < close) {
    depth += 1;
    cursor = open + 8;
    continue;
  }

  if (depth === 0) {
    cursor = close + marker.length;
    break;
  }

  depth -= 1;
  cursor = close + marker.length;
}

const removed = source.slice(from, cursor);

source = source.slice(0, from) + source.slice(cursor);

fs.writeFileSync(path, source);

console.log(`removed ${removed.length} characters from index.html`);
console.log(`first line was: ${removed.split("\n")[0]}`);
