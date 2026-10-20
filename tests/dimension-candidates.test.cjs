
const path = require("path");

const { loadModule, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
/*
 * The Dimension tool's candidate choice, tested directly.
 *
 * What is worth checking here is JUDGEMENT, not geometry - the
 * geometry is the measurement layer's and is tested there. So the
 * questions are the ones a student would ask: does it pick the
 * conventional measurement, does it refuse to bury one useful number
 * under several unasked-for ones, and does it decline to duplicate
 * what is already on the drawing.
 *
 * Pure module, so it runs in Node.
 */

global.window = { crypto: { randomUUID: () => "smart-uuid" } };

loadModule("measurement-core.js");

global.window.enggDrawingState = {
  polygonVertices: (geometry) => {
    const centre = geometry?.center || { x: 0, y: 0 };
    const radius = Number(geometry?.radius) || 0;
    const sides = Number(geometry?.sides) || 4;

    return Array.from({ length: sides }, (_, index) => {
      const angle = (index * 2 * Math.PI) / sides;

      return {
        x: centre.x + radius * Math.cos(angle),
        y: centre.y + radius * Math.sin(angle)
      };
    });
  }
};

global.window.enggFeatureGeometry = {
  rectangleCorners: (geometry) => {
    const { position = { x: 0, y: 0 }, width = 0, height = 0 } =
      geometry || {};

    return [
      position,
      { x: position.x + width, y: position.y },
      { x: position.x + width, y: position.y + height },
      { x: position.x, y: position.y + height }
    ];
  }
};

loadModule("dimension-model.js");

/* The unified Dimension tool's candidate finder (formerly Smart Dimension's). */
const candidates = require(locate("dimension-candidates.js")).default;
const smart = {
  propose: (objects, state) => candidates.descriptorsFor(objects, state),
  includedAngle: (...args) => candidates.includedAngle(...args),
};

let pass = 0;
let fail = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    pass += 1;
    console.log(`  ok   ${name}`);
  } else {
    fail += 1;
    console.log(
      `  FAIL ${name}\n       expected ${JSON.stringify(expected)}` +
        `\n       actual   ${JSON.stringify(actual)}`
    );
  }
};

const state = (...objects) => ({ objects });

const feature = (id, type, geometry) => ({
  id,
  name: id,
  type,
  geometry,
  style: {},
  metadata: {}
});

const typesOf = (proposals) =>
  proposals.map((p) => p.dimensionType);

console.log("\nA line");
const line = feature("l1", "line", {
  start: { x: 0, y: 0 },
  end: { x: 120, y: 0 }
});
check(
  "is measured by its length",
  typesOf(smart.propose([line], state())),
  ["horizontal"]
);
check(
  "from its own two ends",
  smart.propose([line], state())[0].refs.map((r) => r.anchor),
  ["start", "end"]
);

console.log("\nA circle");
const circle = feature("c1", "circle", {
  center: { x: 0, y: 0 },
  radius: 25
});
check(
  "is quoted by its diameter, as a circle is",
  typesOf(smart.propose([circle], state())),
  ["diameter"]
);
check(
  "between its opposing edges, not a chord",
  smart.propose([circle], state())[0].refs.map((r) => r.anchor),
  ["east", "west"]
);

console.log("\nA beam");
const beam = feature("b1", "beam", {
  start: { x: 0, y: 0 },
  end: { x: 4000, y: 0 },
  depth: 200
});
check(
  "is measured by its span",
  typesOf(smart.propose([beam], state())),
  ["horizontal"]
);
check(
  "and not by its depth as well, which is not its point",
  smart.propose([beam], state()).length,
  1
);

console.log("\nA rectangle is the case that wants two");
const rectangle = feature("r1", "rectangle", {
  position: { x: 0, y: 0 },
  width: 80,
  height: 40,
  rotation: 0
});
const rectProposals = smart.propose([rectangle], state());
check("is measured by both of its axes", typesOf(rectProposals), ["horizontal", "vertical"]);
check(
  "which is the only feature measured this way here",
  smart.propose([beam], state()).length,
  1
);

console.log("\nA shaft wants its length and its diameter");
const shaft = feature("s1", "shaft", {
  start: { x: 0, y: 0 },
  end: { x: 500, y: 0 },
  diameter: 40
});
const shaftProposals = smart.propose([shaft], state());
check("is measured by both", typesOf(shaftProposals), ["linear", "diameter"]);
check(
  "and the diameter reads its own stored value, not a distance",
  shaftProposals[1].refs[0],
  { kind: "property", featureId: "s1", property: "diameter" }
);

console.log("\nA circle's radius is not given when a diameter answers it");
check(
  "one measurement, not two",
  smart.propose([circle], state()).length,
  1
);

console.log("\nA point");
const point = feature("p1", "point", { position: { x: 10, y: 20 } });
check(
  "is measured by where it is",
  typesOf(smart.propose([point], state())),
  ["coordinate"]
);
check(
  "from its one position",
  smart.propose([point], state())[0].refs.map((r) => r.anchor),
  ["position"]
);

console.log("\nA load is measured by its span, never its intensity");
const load = feature("load-1", "load", {
  start: { x: 0, y: 0 },
  end: { x: 100, y: 0 },
  intensity: 5,
  points: []
});
check(
  "is measured by what it covers",
  typesOf(smart.propose([load], state())),
  ["horizontal"]
);

console.log("\nTwo features");
const legOne = feature("a1", "line", { start: { x: 0, y: 0 }, end: { x: 100, y: 0 } });
const legTwo = feature("a2", "line", { start: { x: 0, y: 0 }, end: { x: 0, y: 80 } });
check(
  "that meet at an angle are measured by that angle",
  typesOf(smart.propose([legOne, legTwo], state())),
  ["angular"]
);
check(
  "which needs a reference on each",
  smart.propose([legOne, legTwo], state())[0].refs.length,
  2
);
check(
  "and they name different features",
  new Set(
    smart.propose([legOne, legTwo], state())[0].refs.map(
      (r) => r.featureId
    )
  ).size,
  2
);

console.log("\nTwo features that are parallel");
const parallel = feature("a3", "line", { start: { x: 0, y: 50 }, end: { x: 100, y: 50 } });
check(
  "are measured by the distance between them",
  typesOf(smart.propose([legOne, parallel], state())),
  ["vertical"]
);
check(
  "and specifically not by the zero angle between them",
  typesOf(
    smart.propose([legOne, parallel], state())
  ).includes("angular"),
  false
);

console.log("\nTwo circles are located by their centres");
const circleB = feature("c2", "circle", { center: { x: 100, y: 0 }, radius: 10 });
const pairCircles = smart.propose([circle, circleB], state());
check("by one measurement between them", pairCircles.length, 1);
check(
  "that is a distance",
  typesOf(pairCircles),
  ["linear"]
);

console.log("\nRedundancy");
const existingDimension = global.window.enggDimensionModel.createDimension({
  dimensionType: "horizontal",
  refs: [
    { featureId: "b1", anchor: "start" },
    { featureId: "b1", anchor: "end" }
  ],
  placement: { x: 2000, y: 300 }
});
check(
  "a beam that already has its span is not given another",
  smart.propose([beam], state(existingDimension)),
  []
);
check(
  "but a beam without one still is",
  smart.propose([beam], state()).length,
  1
);
const heightDimension = global.window.enggDimensionModel.createDimension({
  dimensionType: "vertical",
  refs: [
    { featureId: "b1", anchor: "start" },
    { featureId: "b1", anchor: "end" }
  ],
  placement: { x: 0, y: 0 }
});
check(
  "and a DIFFERENT measurement of it is not suppressed",
  smart.propose([beam], state(heightDimension)).length,
  1
);

console.log("\nMany features");
const many = [
  feature("m1", "line", { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }),
  feature("m2", "line", { start: { x: 0, y: 20 }, end: { x: 20, y: 20 } }),
  feature("m3", "line", { start: { x: 0, y: 40 }, end: { x: 30, y: 40 } }),
  feature("m4", "line", { start: { x: 0, y: 60 }, end: { x: 40, y: 60 } })
];
check(
  "are measured one apiece, not every pair",
  smart.propose(many, state()).length,
  4
);
check(
  "with no dimension between them appearing",
  smart.propose(many, state()).some((p) => p.sourceType === "pair"),
  false
);

console.log("\nWhat is not selected");
check("nothing proposes nothing", smart.propose([], state()), []);
check(
  "and a selected dimension is not measured as geometry",
  smart.propose([existingDimension], state()),
  []
);
check(
  "nor is a selected annotation",
  smart.propose(
    [
      {
        id: "a1",
        type: "annotation",
        geometry: {},
        style: {}
      }
    ],
    state()
  ),
  []
);

console.log("\nIncluded angle");
check(
  "a right angle is ninety",
  Math.round(smart.includedAngle(
    { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
    { start: { x: 0, y: 0 }, end: { x: 0, y: 10 } }
  )),
  90
);
check(
  "a degenerate member has no angle",
  smart.includedAngle(
    { start: { x: 0, y: 0 }, end: { x: 0, y: 0 } },
    { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }
  ),
  null
);

console.log("\nProposals are descriptors, not objects");
const proposal = smart.propose([beam], state())[0];
check(
  "so nothing has been created yet",
  Object.prototype.hasOwnProperty.call(proposal, "id"),
  false
);
check(
  "and the student still chooses where it goes",
  Object.prototype.hasOwnProperty.call(proposal, "placement"),
  false
);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
