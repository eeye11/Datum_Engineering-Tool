/*
 * ========================================================
 * CAN ONE PROPERTY BE BOUND TO TWO FIELDS AT ONCE?
 * ========================================================
 *
 * The Cable panel rendered its Span and its Length with the same data-property
 * key. Two inputs, one binding: typing into either silently overwrote the
 * other, and nothing on the panel said so. For a STRAIGHT cable the two
 * numbers are equal, so it looked harmless - which is exactly why it survived
 * - and it only becomes visibly wrong when a cable is drawn with sag and the
 * two quantities stop agreeing.
 *
 * That is a generalisable fault, not a one-off, so it is checked generally:
 * within one panel branch, two editable fields must not claim one property.
 *
 * The second half checks the same class of mistake in the other direction -
 * a value that is measured rather than typed must SAY SO. An Angle reading
 * "0.00" on a panel that also states a Length in millimetres is ambiguous,
 * and three angle fields were carrying a middot separator where the degree
 * sign belonged.
 */
const fs = require("fs");
const path = require("path");

const { controllerSource, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");

/*
 * The panel markup moved to components/layout/panels in the Phase 2
 * reorganisation, so the property rows live there; the status-bar middot
 * feedback lives in the pointer module under features/workspace.
 *
 * CRLF is normalised so the line numbers reported below are stable.
 */
const code = [
  "feature-panel-markup.js",
  "appearance-panel.js",
  "statics-panel.js",
  "feature-panel.js",
  "property-panel.js",
  "pointer.js",
].map((name) => fs.readFileSync(modulePath(name), "utf8").replace(/\r\n/g, "\n")).join("\n");

/*
 * The appearance panel's own text, for the line-width unit checks below.
 * Since the Phase 2 reorganisation the width field lives there rather than
 * inside the feature-panel markup.
 */
const lineWidthRow = fs
  .readFileSync(modulePath("appearance-panel.js"), "utf8")
  .replace(/\r\n/g, "\n");

let pass = 0;
let fail = 0;

/*
 * THE SOURCE BETWEEN TWO MARKERS.
 *
 * So a check cannot be satisfied by an unrelated occurrence of the same name
 * somewhere else in a 21k-line file - which is the failure mode that lets a
 * source-level test report a fix that is not there.
 */
const section = (startMarker, endMarker) => {
  const start = code.indexOf(startMarker);

  if (start < 0) {
    return "";
  }

  const end = code.indexOf(endMarker, start + startMarker.length);

  return code.slice(start, end < 0 ? undefined : end);
};

const check = (name, ok, detail) => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(
      `  FAIL ${name}${detail ? `\n       ${detail}` : ""}`,
    );
  }
};

/*
 * Every `scalar("Label", "key", ...)` call site in the file, with the branch
 * it sits in. The branch is what makes a duplicate meaningful: Span and Length
 * on the same panel collide, while Length on a Beam and Length on a Truss are
 * different panels and cannot.
 */
const callSites = [];

const lines = code.split(/\r?\n/);

lines.forEach((line, index) => {
  const match = line.match(
    /scalar\(\s*"([^"]+)"\s*,\s*"([^"]+)"/,
  );

  if (!match) {
    return;
  }

  callSites.push({
    line: index + 1,
    label: match[1],
    key: match[2],
    source: line.trim(),
  });
});

console.log(
  `\n  ${callSites.length} editable fields found\n`,
);

/*
 * Walk backwards from each call site to the branch that opens it, so two
 * fields are only compared when they can appear on the SAME panel.
 *
 * Two kinds of line open a branch, and both have to be recognised:
 *
 *   object.type === "cable"   an explicit test
 *   } else {                   a fall-through - the last branch of a group
 *
 * Recognising only the first mis-attributes every field in a trailing `else`
 * to whichever named test happens to come before it. That is not theoretical:
 * the Shaft panel IS a trailing `else`, so its Length was being reported as a
 * collision with the Cable panel's Span - two panels that never appear
 * together - and the test was about to send me editing the wrong code.
 */
const branchOf = (lineNumber) => {
  for (let i = lineNumber - 1; i >= 0; i--) {
    const typeMatch = lines[i].match(
      /object\.type === "([a-z-]+)"/,
    );

    if (typeMatch) {
      return typeMatch[1];
    }

    // A closing `} else {` opens a branch of its own.
    if (/^\s*\}\s*else\s*\{?\s*$/.test(lines[i])) {
      return `(else branch)`;
    }
  }

  return "(shared)";
};

const byBranch = new Map();

callSites.forEach((site) => {
  const branch = branchOf(site.line);

  if (!byBranch.has(branch)) {
    byBranch.set(branch, []);
  }

  byBranch.get(branch).push(site);
});

console.log("\n  NO PANEL BINDS ONE PROPERTY TO TWO FIELDS\n");

let duplicates = 0;

byBranch.forEach((sites, branch) => {
  const seen = new Map();

  sites.forEach((site) => {
    const key = site.key;

    if (seen.has(key)) {
      duplicates++;

      check(
        `${branch}: "${site.label}" does not collide with "${seen.get(key).label}"`,
        false,
        `both write property "${key}" - ${seen.get(key).label} is on line ${seen.get(key).line} and ${site.label} on line ${site.line}. Typing into either silently overwrites the other.`,
      );
    } else {
      seen.set(key, site);
    }
  });
});

check(
  'the Cable Span/Length collision is gone',
  !callSites.some(
    (s) =>
      s.key === "length" &&
      branchOf(s.line) === "cable" &&
      s.label === "Length",
  ),
  'the cable panel still writes "Length" to property "length", which Span also writes',
);

/*
 * The Shaft panel is a trailing `else`, so its Length must be attributed to
 * that branch and not to the Cable panel above it. If this regresses, the
 * collision check silently stops comparing real collisions on the shaft.
 */
check(
  'the Shaft panel is not attributed to another feature',
  !callSites.some(
    (s) =>
      s.label === "Length" &&
      branchOf(s.line) === "cable",
  ),
  "a trailing else-branch was attributed to the panel above it",
);

check(
  "no panel binds one property twice",
  duplicates === 0,
  `${duplicates} collision(s) found`,
);

console.log("\n  AND A MEASURED VALUE SAYS WHAT IT IS\n");

/*
 * " · " as a unit. It renders as "0.00 ·", which is a separator with nothing
 * after it - the same empty-value-with-punctuation shape as "Direction: ,",
 * produced by the same mistake of using a display character where a unit
 * belongs.
 */
const middotUnits = lines
  .map((line, index) => ({ line: index + 1, text: line }))
  .filter(
    (entry) =>
      /scalar\(|derived\(/.test(entry.text) &&
      /" · "|' · '/.test(entry.text),
  );

check(
  "no field uses a middot where a unit belongs",
  middotUnits.length === 0,
  middotUnits
    .map((e) => `line ${e.line}: ${e.text.trim()}`)
    .join("\n       "),
);

/*
 * " · " is legitimate in the STATUS BAR, where it joins two different pieces
 * of guidance ("Specify second point · Snap: Midpoint"). That is not a panel
 * and not a unit, so those uses must survive this cleanup.
 */
const statusBarJoins = lines.filter(
  (line) =>
    line.includes('join(') && line.includes('" · "'),
).length;

check(
  "but the status bar still joins its feedback with a middot",
  statusBarJoins > 0,
  "the middot cleanup removed legitimate status-bar separators too",
);

/*
 * A derived angle or length carries its unit. An angle reading "0.00" beside
 * a Length in mm is ambiguous between degrees and millimetres.
 */
const angleRows = lines
  .map((line, index) => ({ line: index + 1, text: line }))
  .filter((entry) => /"Angle"|"Start Angle"|"End Angle"|"Included"/.test(entry.text));

angleRows.forEach((entry) => {
  const hasDegree = entry.text.includes('"°"');
  const isStatus = entry.text.includes("join(");

  if (isStatus) {
    return;
  }

  check(
    `line ${entry.line}: an angle states its unit`,
    hasDegree ||
      !entry.text.includes("scalar(") ||
      entry.text.trim().startsWith("rows.push"),
    `an angle field with no degree sign: ${entry.text.trim()}`,
  );
});

console.log("\n  A COUNT IS NOT A MEASUREMENT\n");

/*
 * Counts were going through the same formatter as lengths, which rounds
 * everything to two decimal places - so "Segment Count 1.00". Two decimals
 * claim the number was measured from something continuous and might be
 * approximate. There are four joints or there are not.
 */
const countRows = lines
  .map((line, index) => ({ line: index + 1, text: line.trim() }))
  .filter((entry) =>
    /"(Joint Count|Member Count|Segment Count|Supports|Connections)"/.test(
      entry.text,
    ),
  );

check(
  "the count fields were found",
  countRows.length >= 5,
  `only ${countRows.length} found`,
);

check(
  "no count is still rendered by the measurement formatter",
  !lines.some(
    (line) =>
      /derived\(/.test(line) &&
      /"(Joint Count|Member Count|Segment Count|Supports|Connections)"/.test(
        line,
      ),
  ),
  "at least one count still goes through the two-decimal formatter",
);

const countHelper = section(
  "const derivedCount =",
  "rows.push(featureHeaderMarkup",
);

check(
  "a count is rounded to a whole number",
  /Math\.round\(/.test(countHelper),
  "a count must not carry decimal places",
);

check(
  "and prints no decimals at all",
  !/toFixed\(/.test(countHelper),
  "toFixed reintroduces the decimals the helper exists to remove",
);

console.log(
  "\n  A LINE WIDTH IS NOT AN ENGINEERING LENGTH\n",
);

/*
 * It was labelled "mm", which put a screen property in the same vocabulary as
 * the lengths on the same panel. A beam 500 mm long and one 5000 mm long are
 * drawn with the same pen - the value goes to SVG stroke-width - so "mm"
 * claimed the pen describes the geometry, which is the exact confusion the
 * document scale exists to prevent.
 */
/*
 * It was labelled "mm", which put a screen property in the same vocabulary as
 * the lengths on the same panel. A beam 500 mm long and one 5000 mm long are
 * drawn with the same pen - the value goes to SVG stroke-width - so "mm"
 * claimed the pen describes the geometry, which is the exact confusion the
 * document scale exists to prevent. `lineWidthRow` is read at the top of the
 * file, from the appearance panel's own module.
 */
check(
  "the line width field was found",
  lineWidthRow.includes('"Line Width"'),
);
check(
  'it is not labelled as millimetres',
  !/drawing-property-unit">mm<\/span>\s*<span><\/span>\s*<\/div>/.test(
    lineWidthRow.split('"Line Width"')[1] || "",
  ),
  "a screen-space pen width is still labelled with an engineering unit",
);

check(
  "it states a line-weight unit instead",
  /drawing-property-unit">pt<\/span>/.test(lineWidthRow),
  "the line width now has no unit, so it reads as an unexplained bare number",
);

check(
  "and the value still goes to the style, not to geometry",
  /data-style="lineWidth"/.test(lineWidthRow),
);

console.log(
  `\n${pass} passed, ${fail} failed`,
);

if (fail > 0) {
  process.exitCode = 1;
}
