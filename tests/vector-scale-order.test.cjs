
const path = require("path");

const { loadModule, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
/*
 * IS THE VECTOR SCALE LISTED IN A REASONABLE ORDER, AND A REASONABLE
 * RANGE?
 *
 * A control read top to bottom should read small to large, the way every
 * other quantity on a sheet does. The list used to run 1, 0.1, 0.01,
 * 0.001, 10, 100, 1000 - shrinking then growing - which is the order a
 * user reaches for the values in but makes the list impossible to scan
 * and impossible to tell at a glance which side of 1 an entry is on.
 *
 * It also ran to a thousandfold in each direction, which is a wider range
 * than a drawing control can usefully offer. The list is now the five
 * doublings around 1 a student actually reaches for, in increasing order,
 * with the custom field still there for anything else.
 *
 * The check is on the ORDER, and separately on the things that must not
 * change while reordering: the default is still 1, every value is still
 * present exactly once, and 1 still sits in the middle.
 */

global.window = {};

loadModule("load-profile.js");

const profile = global.window.enggLoadProfile;

let pass = 0;
let fail = 0;

const check = (name, ok, detail) => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(
      `  FAIL ${name}${detail ? `\n       ${detail}` : ""}`
    );
  }
};

const options = profile.VECTOR_SCALE_OPTIONS;

console.log("\n  the Vector Scale is listed small to large\n");

/* THE CENTRAL CLAIM: the values ascend. */
const values = options.map(option => option.value);

const ascending = values.every(
  (value, index) =>
        index === 0 || value > values[index - 1]
);

check(
  "the options are in increasing numerical order",
  ascending,
  `order: ${values.join(", ")}`
);

/*
 * ...WHICH THE LABELS MUST ALSO HONOUR. A list sorted by value and labelled
 * in another order would be worse than either: the eye reads the label,
 * not the number.
 */
const labelsAscend = options.every(
  (option, index) =>
        index === 0 ||
        Number(option.label.replace("×", "")) >
            Number(
                options[index - 1].label.replace("×", "")
            )
);

check(
  "and the LABELS are in increasing order too, as read",
  labelsAscend,
  `labels: ${options.map(o => o.label).join(", ")}`
);

/*
 * THE DEFAULT IS UNCHANGED. Reordering a list is a change of
 * presentation, and the sheet every document opens on must look the same
 * it did.
 *
 * Read through the VALUE rather than a constant: `DEFAULT_VECTOR_SCALE`
 * is a module constant that is not published on the registry, and an
 * earlier version of this asserted it was, failed, and looked like the
 * default had been lost when nothing had been reordered at all. What the
 * panel actually does is treat an unset value as 1, and that is the
 * thing worth pinning.
 */
check(
  "an unset sheet still reads as 1x",
  profile.vectorScaleFor({}) === 1,
  `got ${profile.vectorScaleFor({})}`
);

check(
  "a sheet with no statics block still reads as 1x",
  profile.vectorScaleFor({ statics: {} }) === 1,
  `got ${profile.vectorScaleFor({ statics: {} })}`
);

/*
 * EVERY VALUE IS STILL PRESENT, ONCE. A sort that dropped or duplicated
 * an entry would leave a student unable to choose a scale they had used
 * before, with nothing to say so.
 */
check(
  "no value is duplicated",
  new Set(values).size === values.length,
  `values: ${values.join(", ")}`
);

check(
  "no value is missing",
  [0.001, 0.01, 0.1, 1, 10, 100, 1000].every(v =>
    values.includes(v)
  ),
  `values: ${values.join(", ")}`
);

check(
  "and the specification's practical multipliers are present too",
  [0.25, 0.5, 1, 2, 4].every(v => values.includes(v)),
  `values: ${values.join(", ")}`
);

/*
 * THE RANGE IS THE DECADES BOTH WAYS ROUND ONE.
 *
 * An engineering sheet routinely holds quantities that differ by orders of
 * magnitude - a 5 N reaction beside a 50 kN load - and the scale has to be able
 * to put both of them on one readable page. Doublings could not: from 1x the
 * next step up was 2x and the next down 0.5x, so fitting a 50 kN load beside a
 * 5 N reaction meant either an unreadable sheet or typing the value by hand.
 *
 * Three decades each way covers that range, and the custom field is still the
 * escape hatch for anything outside it.
 */
check(
  "the range spans three decades either side of 1",
  values[0] === 0.001 && values[values.length - 1] === 1000,
  `range ${values[0]} to ${values[values.length - 1]}`
);

/*
 * EVERY DECADE IS STILL THERE. The list also carries the practical
 * multipliers (0.25x, 0.5x, 2x, 4x), so the steps are no longer uniformly
 * tenfold - but each decade must still be present, because the decades are
 * what let one sheet hold quantities orders of magnitude apart.
 */
check(
  "every decade is present, in order",
  [0.001, 0.01, 0.1, 1, 10, 100, 1000].every(
    (v) =>
      values.includes(v) &&
      values.indexOf(v) ===
        values.findIndex((x) => x >= v)
  ),
  `values: ${values.join(", ")}`
);

/*
 * 1 IS STILL IN THE LIST, and is the middle of it. A student who wants the
 * true length - which is where every sheet starts - should find it
 * without scrolling past everything smaller or larger.
 */
const middle = values[Math.floor(values.length / 2)];

check(
  "1 sits in the middle, where the eye expects it",
  middle === 1,
  `middle is ${middle}`
);

console.log(
  `\n  ${pass} passed, ${fail} failed\n`
);

if (fail) {
  process.exitCode = 1;
}
