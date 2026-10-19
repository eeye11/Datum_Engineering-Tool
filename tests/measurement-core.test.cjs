
const path = require("path");

const { loadModule, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
/*
 * Measurement core, tested directly.
 *
 * The capability layer is pure - it knows nothing about the DOM and
 * touches no renderer - so it is exercised in Node. That matters here
 * more than usual: the layer's whole job is to answer "what can this
 * feature be measured as, and from where", and a wrong answer here
 * would surface much later as a dimension drawn in the wrong place on
 * the wrong geometry, which is far harder to diagnose.
 */

global.window = {
  enggDrawingState: {
    polygonVertices(geometry) {
      const centre = geometry?.center || { x: 0, y: 0 };
      const radius = Number(geometry?.radius) || 0;
      const sides = Number(geometry?.sides) || 6;

      return Array.from({ length: sides }, (_, index) => {
        const angle = (index * 2 * Math.PI) / sides;

        return {
          x: centre.x + radius * Math.cos(angle),
          y: centre.y + radius * Math.sin(angle)
        };
      });
    }
  },
  enggFeatureGeometry: {
    rectangleCorners(geometry) {
      const { position = { x: 0, y: 0 }, width = 0, height = 0 } =
        geometry || {};

      return [
        position,
        { x: position.x + width, y: position.y },
        { x: position.x + width, y: position.y + height },
        { x: position.x, y: position.y + height }
      ];
    }
  }
};

loadModule("measurement-core.js");

const m = global.window.enggMeasurement;

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

const feature = (type, geometry) => ({ type, geometry });

console.log("\nA horizontal line");
const horizontalLine = feature("line", {
  start: { x: 0, y: 0 },
  end: { x: 100, y: 0 }
});
check(
  "is measured horizontally first",
  m.dimensionCandidates(horizontalLine)[0],
  "horizontal"
);
check(
  "and offers its direct length too",
  m.dimensionCandidates(horizontalLine).includes("linear"),
  true
);
check(
  "exposes its own endpoints, plus the interior points a reference needs",
  m.anchorOptions(horizontalLine),
  ["start", "end", "midpoint", "quarter1", "quarter3"]
);

/*
 * The interior anchors are DERIVED from the ends, not stored. That is
 * the reason to compute them here rather than keep them as geometry:
 * move an end and the midpoint follows it, instead of drifting out of
 * step with the line it describes.
 */
check(
  "and its midpoint is the point halfway along it",
  m.resolveAnchor(horizontalLine, "midpoint"),
  { x: 50, y: 0 }
);

console.log("\nA vertical line");
const verticalLine = feature("line", {
  start: { x: 0, y: 0 },
  end: { x: 0, y: 80 }
});
check(
  "is measured vertically first",
  m.dimensionCandidates(verticalLine)[0],
  "vertical"
);

console.log("\nAn angled line");
const angledLine = feature("line", {
  start: { x: 0, y: 0 },
  end: { x: 30, y: 40 }
});
check(
  "is measured along its own direction",
  m.dimensionCandidates(angledLine)[0],
  "aligned"
);
/*
 * A single span has no included angle of its own - an angle needs a
 * second thing to be measured against - so the span candidates stop at
 * the direct distance. The angle between TWO spans is offered by the
 * pair candidates further down, which is the only place it can be
 * answered.
 */
check(
  "and stops short of an angle it cannot answer alone",
  m.dimensionCandidates(angledLine).includes("angular"),
  false
);

console.log("\nA beam stays a beam");
const beam = feature("beam", {
  start: { x: -200, y: 0 },
  end: { x: 200, y: 0 },
  depth: 120
});
check("it is known as its own type", m.known("beam"), true);
check(
  "is measured like the span it really is",
  m.dimensionCandidates(beam)[0],
  "horizontal"
);
check(
  "and its depth does not become a second dimension",
  m.dimensionCandidates(beam).length,
  2
);
check(
  "its endpoints resolve to its own geometry",
  m.resolveAnchor(beam, "end"),
  { x: 200, y: 0 }
);

console.log("\nA circle");
const circle = feature("circle", {
  center: { x: 0, y: 0 },
  radius: 25
});
check(
  "is quoted by its diameter first",
  m.dimensionCandidates(circle)[0],
  "diameter"
);
check(
  "which carries the diameter symbol",
  m.DIMENSION_TYPES.diameter.prefix,
  "Ø"
);
check(
  "and a radius is available",
  m.dimensionCandidates(circle).includes("radius"),
  true
);
check(
  "its east anchor is its real edge",
  m.resolveAnchor(circle, "east"),
  { x: 25, y: 0 }
);

console.log("\nAn arc");
const arc = feature("arc", {
  center: { x: 0, y: 0 },
  radius: 10,
  startAngle: 0,
  endAngle: Math.PI / 2
});
check("is measured by its radius", m.dimensionCandidates(arc)[0], "radius");
check(
  "and can be measured along the sweep",
  m.dimensionCandidates(arc).includes("arc-length"),
  true
);
check(
  "its start anchor is on the arc, not the centre",
  m.resolveAnchor(arc, "start"),
  { x: 10, y: 0 }
);

console.log("\nA rectangle");
const rectangle = feature("rectangle", {
  position: { x: 0, y: 0 },
  width: 80,
  height: 40,
  rotation: 0
});
check(
  "offers its own axes",
  m.dimensionCandidates(rectangle).slice(0, 2),
  ["horizontal", "vertical"]
);
check(
  "exposes four corners, its centre, and each edge as a segment",
  m.anchorOptions(rectangle).length,
  5 + 12
);
/*
 * The four named corners are still there, and the edge segments are added
 * alongside them - a rectangle is dimensioned by an edge behaving like a line,
 * so each edge publishes its two ends and its midpoint.
 */
check(
  "with the corners still among them",
  ["topLeft", "topRight", "bottomRight", "bottomLeft", "center"].every(
    (name) => m.anchorOptions(rectangle).includes(name)
  ),
  true
);
check(
  "and the first edge named as a segment",
  m.anchorOptions(rectangle).includes("segment0Start") &&
    m.anchorOptions(rectangle).includes("segment0Mid"),
  true
);

console.log("\nA point force");
const force = feature("force", {
  start: { x: 10, y: 20 },
  end: { x: 10, y: -20 },
  position: { x: 10, y: 20 },
  magnitude: 40,
  angle: -90
});
check(
  "is measured by where it acts, not how big it is",
  m.dimensionCandidates(force)[0],
  "vertical"
);
check(
  "its application point is its own start",
  m.resolveAnchor(force, "start"),
  { x: 10, y: 20 }
);

console.log("\nA distributed load");
const load = feature("load", {
  start: { x: 0, y: 0 },
  end: { x: 60, y: 0 },
  intensity: 5,
  points: []
});
check(
  "is dimensioned by its loaded span",
  m.dimensionCandidates(load)[0],
  "horizontal"
);
check(
  "and never by an intensity",
  m.dimensionCandidates(load).includes("arc-length"),
  false
);

console.log("\nSupports and particles");
const support = feature("pin-support", {
  position: { x: -200, y: 0 },
  orientation: 0
});
check("a support is measured by its location", m.anchorOptions(support), ["position"]);
check(
  "a particle is not turned into a point",
  m.capabilitiesFor("particle").type,
  "particle"
);

console.log("\nAn unknown future feature");
const spring = feature("spring", {
  start: { x: 0, y: 0 },
  end: { x: 40, y: 0 }
});
check("is still dimensionable", m.dimensionCandidates(spring).length > 0, true);
check("through its own geometry", m.resolveAnchor(spring, "start"), { x: 0, y: 0 });

console.log("\nA feature registering itself");
m.register("gear", {
  dimensions: ["diameter"],
  anchorNames: () => ["centre"],
  anchors: (object) => ({ centre: object.geometry.centre })
});
check(
  "adds support without touching the system",
  m.dimensionCandidates(feature("gear", { centre: { x: 1, y: 2 } })),
  ["diameter"]
);
check(
  "and resolves its own anchor",
  m.resolveAnchor(feature("gear", { centre: { x: 1, y: 2 } }), "centre"),
  { x: 1, y: 2 }
);

console.log("\nAn anchor that cannot resolve");
const brokenLine = feature("line", {
  start: { x: 0, y: 0 },
  end: { x: Number.NaN, y: 0 }
});
check("resolves to null", m.resolveAnchor(brokenLine, "end"), null);
check(
  "and is reported as unresolved",
  m.anchorResolves(brokenLine, "end"),
  false
);

console.log("\nTwo features");
check(
  "two points offer a direct distance",
  m.pairCandidates(
    feature("point", { position: { x: 0, y: 0 } }),
    feature("point", { position: { x: 30, y: 40 } })
  )[0],
  "linear"
);
check(
  "aligned points offer the horizontal distance first",
  m.pairCandidates(
    feature("point", { position: { x: 0, y: 0 } }),
    feature("point", { position: { x: 50, y: 0 } })
  )[0],
  "horizontal"
);
/*
 * Two spans are measured BETWEEN by a distance.
 *
 * Not by the angle between them: the layer cannot tell two parallel
 * spans from two crossing ones, so any angle it offered here would be
 * a vacuous 0 degrees as often as not. Deciding whether two spans
 * enclose a meaningful angle belongs to the caller that can look at
 * them - Smart Dimension - and the layer answers the distance, which
 * is a real measurement for any pair.
 */
check(
  "and two spans are measured between by a distance",
  ["linear", "horizontal", "vertical"].includes(
    m.pairCandidates(horizontalLine, angledLine)[0]
  ),
  true
);
check(
  "with no angle offered by the layer",
  m.pairCandidates(horizontalLine, angledLine).includes("angular"),
  false
);

console.log("\nAngles carry no unit");
check("an angle has no unit", m.DIMENSION_TYPES.angular.unit, false);
check("a length does", m.DIMENSION_TYPES.linear.unit, true);
check("and is recognised as angular", m.isAngular("angular"), true);
check("a linear one is not", m.isAngular("linear"), false);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
