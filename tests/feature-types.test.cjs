/*
 * THE FEATURE-TYPE REGISTRY (src/shared/model/feature-types.js).
 *
 * Each group below was once a list kept privately by an editor module.
 * They now come from one table; these are the exact memberships those lists
 * had, so moving them changed nothing, and a type moved between groups by
 * accident is caught here.
 */
const { loadModule } = require("./helpers/source-path.cjs");

const types = loadModule("feature-types.js");

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

const same = (name, actual, expected) =>
  check(name, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}`);

const ALL = Object.keys(types.FEATURE_TYPES);
const members = (predicate) => ALL.filter(predicate).sort();

same(
  "bodies, in the order the Statics tools offer them",
  types.STATICS_BODY_TYPES,
  [
    "particle",
    "rigid-body",
    "beam",
    "truss",
    "cable",
    "shaft",
    /*
     * A PIPE / DUCT RUN IS A BODY. It is a run a Statics feature may attach
     * to, exactly as a Beam is, so it is declared with `body: true` and appears
     * in the same list. It is listed last because it is declared last, and the
     * order is the order the tools offer them.
     */
    "pipe-duct",
  ],
);

same(
  "supports",
  members(types.isSupportType),
  ["fixed-support", "pin-support", "roller-support", "smooth-support"],
);

same(
  "connections (the legacy generic 'connection' is not one)",
  members(types.isConnectionType),
  ["fixed-connection", "pin-connection", "slider-connection"],
);

same(
  "attachable Statics features",
  members(types.attachableStaticsType),
  ["fixed-support", "force", "load", "moment", "pin-support", "roller-support", "smooth-support", "varying-load"],
);

same(
  "span-shaped features",
  members(types.isSpanShapedType),
  [
    "beam",
    "cable",
    "connection",
    /*
     * A PIPE / DUCT RUN AND AN ELBOW BOTH RUN BETWEEN TWO ENDS, so both are
     * span-shaped. Declaring them here is what lets box selection and the
     * measurement layer see them as runs rather than as loose points.
     */
    "elbow",
    "fixed-connection",
    "line",
    "pin-connection",
    "pipe-duct",
    /*
     * A POLYLINE IS A CHAIN OF SPANS. It was missing from the table, and that
     * omission is exactly why a polyline crossed by a selection rectangle was
     * not selected - the shared systems had not been told it was made of lines.
     */
    "polyline",
    "shaft",
    "slider-connection",
    "truss",
  ],
);

same(
  "features drawn with the shared vector arrows",
  members((type) => types.usesStaticsVectors({ type })),
  ["force", "load", "resultant", "varying-load"],
);

check("an unknown type belongs to no group", !types.isSupportType("nonsense") && !types.isStaticsBodyType(undefined));
check("a missing object uses no vectors", types.usesStaticsVectors(null) === false);
check("the table cannot be changed at run time", Object.isFrozen(types.FEATURE_TYPES));

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
