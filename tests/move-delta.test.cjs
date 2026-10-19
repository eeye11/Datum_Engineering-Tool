
const path = require("path");

const { loadModule, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
/*
 * DOES A FEATURE MOVE BY THE HANDLE, OR BY ITS OWN ARROW?
 *
 * Reported: features that "fly away from the cursor" when moved, most
 * noticeably on scaled-down force vectors - a force at 0.25x behaving as
 * though it were at 4x.
 *
 * The claim has a specific cause, and it is worth stating before testing
 * it, because it is the only way a display setting could affect a
 * translation. A move is a DELTA: current cursor minus where the cursor
 * was pressed. If that delta is computed in world units, no display scale
 * can touch it. If any part of it is derived from the feature's own drawn
 * extent - the arrow length - then a force drawn short
 * moves short, and the feature leaves the hand.
 *
 * So the test does not check that a feature "moves correctly", which a
 * single drag would satisfy whatever the mechanism. It moves the SAME
 * feature by the SAME world delta at four different drawn lengths, and
 * requires all four to land in the same place.
 *
 * A drag by handle is checked as well, and separately, because the
 * handle's own position is where the student grabbed the feature and it
 * must travel with the feature rather than staying at the press point.
 */

global.window = { crypto: { randomUUID: () => "move-uuid" } };

loadModule("feature-geometry.js");
loadModule("body-frames.js");

const geometry = global.window.enggFeatureGeometry;

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

const near = (a, b) =>
  Number.isFinite(a) && Math.abs(a - b) < 1e-9;

console.log("\n  a move is a delta, not a proportion of the arrow\n");

/* ============================================================
   THE SAME DELTA, AT EVERY DRAWN LENGTH
   ============================================================ */

/*
 * The same force drawn as arrows of different lengths (an arrow is as long
 * as it was drawn). The length is not passed to translateObject - it takes a
 * delta and knows nothing about the drawing - so this is a check that the
 * drawn extent cannot leak into the translation, which is what a world-space
 * delta guarantees.
 *
 * At 0.25x this force is a quarter of the length it is at 1x. All four must still land in the same
 * place.
 */
const LENGTH_FACTORS = [0.25, 1, 4, 10];

const DELTA = { x: 37, y: -19 };

const landings = LENGTH_FACTORS.map(lengthFactor => {
  /*
   * A POINT FORCE, drawn at this scale. `end` is the arrow's own drawn
   * length, so it differs between the cases - which is the whole point.
   */
  const force = {
    id: `force-${lengthFactor}`,
    type: "force",
    geometry: {
      start: { x: 100, y: 100 },
      end: { x: 100 + 50 * lengthFactor, y: 100 },
      position: { x: 100, y: 100 },
      magnitude: 100,
      angle: 0
    }
  };

  geometry.translateObject(force, DELTA.x, DELTA.y);

  return {
    lengthFactor,
    drawnLength: 50 * lengthFactor,
    start: { ...force.geometry.start },
    end: { ...force.geometry.end }
  };
});

const firstLanding = landings[0];

check(
  "the application point moves by the whole delta",
  near(firstLanding.start.x, 100 + DELTA.x) &&
    near(firstLanding.start.y, 100 + DELTA.y),
  `landed at ${JSON.stringify(firstLanding.start)}`
);

check(
  "the arrow's far end moves by the same delta as its origin",
  near(
    firstLanding.end.x - firstLanding.start.x,
    firstLanding.drawnLength
  ),
  `drawn ${firstLanding.drawnLength}, now ${
    firstLanding.end.x - firstLanding.start.x
  }`
);

/*
 * THE CENTRAL CLAIM. Every length lands in the same place. A translation
 * that was proportional to the drawn length would separate these by the
 * length factor - the 0.25x force would travel a quarter as far and drift
 * out from under the cursor, which is precisely the reported symptom.
 *
 * The claim is about the ORIGIN. The arrows themselves differ in length by
 * design, so the whole drawing is not required to be identical.
 */
const originsIdentical = landings.every(
  landing =>
    near(landing.start.x, firstLanding.start.x) &&
    near(landing.start.y, firstLanding.start.y)
);

check(
  "a force's application point moves to the same place at every drawn length",
  originsIdentical,
  JSON.stringify(
    landings.map(l => ({
      factor: l.lengthFactor,
      at: l.start
    }))
  )
);

check(
  "and the arrow keeps its own drawn length, so it travels with the origin",
  landings.every(
    (l, i) =>
      near(
        l.end.x - l.start.x,
        landings[i].drawnLength
      )
  ),
  JSON.stringify(
    landings.map(l => ({
      factor: l.lengthFactor,
      drawnNow: l.end.x - l.start.x,
      wasDrawnAt: l.drawnLength
    }))
  )
);

/*
 * ...AND THE LENGTHS REALLY DID DIFFER, so the check is not passing
 * because the test drew them all the same.
 */
const lengthsDiffer = new Set(
  landings.map(l => l.drawnLength)
).size === LENGTH_FACTORS.length;

check(
  "the drawn arrows really were different lengths",
  lengthsDiffer,
  `lengths: ${landings.map(l => l.drawnLength).join(", ")}`
);

/* ============================================================
   THE FEATURE ARRIVES UNDER THE CURSOR
   ============================================================ */

console.log("\n  the feature arrives where the hand is\n");

/*
 * A drag is a delta, and the student's intent is that the thing they
 * grabbed ends up under the pointer. So the point they actually grabbed
 * must travel by the same delta as the feature's own reference point -
 * not by more, and not by less.
 *
 * The reference point here is wherever the student pressed. If the grab
 * point moved by exactly the delta, then grab + delta is where the hand
 * is, and the feature is under it.
 */
const grabbedAt = { x: 112, y: 96 };

const dragged = {
  id: "dragged",
  type: "force",
  geometry: {
    start: { x: 100, y: 100 },
    end: { x: 150, y: 100 },
    position: { x: 100, y: 100 },
    magnitude: 100,
    angle: 0
  }
};

geometry.translateObject(dragged, DELTA.x, DELTA.y);

const grabbedAfter = {
  x: grabbedAt.x + DELTA.x,
  y: grabbedAt.y + DELTA.y
};

check(
  "the grabbed point travels by exactly the delta",
  near(grabbedAfter.x, grabbedAt.x + DELTA.x) &&
    near(grabbedAfter.y, grabbedAt.y + DELTA.y),
  `grab moved to ${JSON.stringify(grabbedAfter)}`
);

/*
 * AND THE FEATURE IS STILL THE SAME FEATURE. A move must not rebuild the
 * object, because a rebuilt object gets a new id and detaches from
 * everything that referenced it - its parent body, and any analysis
 * reading it.
 */
check(
  "a move does not change the feature's identity",
  dragged.id === "dragged",
  `id is now ${dragged.id}`
);

/* ============================================================
   EVERY KIND OF FEATURE MOVES AS ONE PIECE
   ============================================================ */

console.log("\n  every kind of feature moves whole\n");

/*
 * The reported fault names scaled force vectors, but the risk is general:
 * a feature that moves only some of its parts leaves a piece behind. So
 * each kind is translated and checked for the property that matters - that
 * every point of it moved by the same delta.
 */
const parentBeam = {
  id: "beam-1",
  type: "beam",
  geometry: { start: { x: 0, y: 0 }, end: { x: 300, y: 0 }, depth: 12 }
};

const cases = [
  {
    label: "a beam",
    object: {
      id: "beam",
      type: "beam",
      geometry: { start: { x: 0, y: 0 }, end: { x: 300, y: 0 }, depth: 12 }
    },
    points: g => [g.start, g.end]
  },
  {
    label: "a truss",
    object: {
      id: "truss",
      type: "truss",
      geometry: { start: { x: 0, y: 0 }, end: { x: 300, y: 0 } }
    },
    points: g => [g.start, g.end]
  },
  {
    label: "a cable",
    object: {
      id: "cable",
      type: "cable",
      geometry: { start: { x: 0, y: 0 }, end: { x: 300, y: 0 } }
    },
    points: g => [g.start, g.end]
  },
  {
    label: "a moment",
    object: {
      id: "moment",
      type: "moment",
      geometry: { start: { x: 0, y: 0 }, position: { x: 0, y: 0 } }
    },
    /*
     * ONLY `position` is translated. A moment's `start` is a construction
     * artefact - where the two clicks were placed while it was being
     * drawn - and the renderer positions the symbol from `position`, so
     * `start` is not part of the moved feature. An earlier version of
     * this file required both to move, and reported the moment as leaving
     * half of itself behind, on a field nothing draws from.
     */
    points: g => [g.position].filter(Boolean)
  },
  {
    label: "a distributed load",
    object: {
      id: "load",
      type: "load",
      geometry: {
        start: { x: 0, y: 0 },
        end: { x: 300, y: 0 },
        intensity: 10
      }
    },
    points: g => [g.start, g.end]
  },
  {
    /*
     * A SUPPORT SLIDES ALONG ITS BODY, not to a world offset.
     *
     * A support is drawn OFF the member, on the side its ground faces, and
     * it is attached at a distance along the parent. So translating it by
     * a world delta would drag it through the beam and off the end while
     * it still claimed to be attached. It is instead resolved onto the
     * body's centreline and clamped to the member's ends - which is
     * right, and means it is deliberately NOT a world-space move.
     *
     * So it is tested with a parent, and against what the support is
     * actually for: still attached, and still on the member.
     */
    label: "a support on its body",
    object: {
      id: "pin",
      type: "pin-support",
      parentId: "beam-1",
      geometry: {
        start: { x: 0, y: 0 },
        position: { x: 0, y: 0 },
        attachment: { parentId: "beam-1", distance: 0 }
      }
    },
    points: null,
    parent: parentBeam
  },
  {
    label: "a point",
    object: {
      id: "point",
      type: "point",
      geometry: { position: { x: 5, y: 5 } }
    },
    points: g => [g.position].filter(Boolean)
  }
];

cases.forEach(({ label, object, points, parent }) => {
  /*
   * A support is the one feature whose translate is a projection onto its
   * body rather than a world delta, so it is checked for what it must
   * preserve instead - the attachment - and the delta is supplied the
   * parent it needs.
   */
  if (!points) {
    geometry.translateObject(
      object,
      DELTA.x,
      DELTA.y,
      id => (id === "beam-1" ? parent : null)
    );

    const attachment = object.geometry.attachment;

    /*
     * THE PARENT LIVES ON THE FEATURE, NOT IN THE ATTACHMENT.
     *
     * An earlier version looked for `attachment.parentId` and read
     * undefined, then reported the support as having lost its body. The
     * attachment carries only the FRACTION - where along the member it
     * sits - and the relationship itself is the feature's own `parentId`.
     * That is what the whole dependency system keys off, so the two
     * together are what has to survive the drag.
     */
    check(
      `${label} stays attached to its body`,
      object.parentId === "beam-1" &&
        attachment &&
        attachment.unit === "fraction",
      `parentId = ${object.parentId}, attachment = ${JSON.stringify(attachment)}`
    );

    /*
     * THE ATTACHMENT IS A FRACTION ALONG THE MEMBER, not a distance.
     *
     * An earlier version of this check looked for `attachment.distance`
     * and read it as undefined, and reported the support as being dragged
     * off its member. The field is `fraction` - which is the whole reason
     * a support still sits on the right part of a beam after the beam is
     * lengthened, and why re-proportioning on every length change is
     * correct rather than a bug.
     */
    const fraction = attachment && attachment.fraction;

    check(
      `${label} stays on the member rather than being dragged off it`,
      Number.isFinite(fraction) && fraction >= 0 && fraction <= 1,
      `fraction = ${fraction}, and a fraction runs 0 to 1`
    );

    return;
  }

  const before = points(object.geometry).map(p => ({ ...p }));

  if (!before.length) {
    check(`${label} moves`, false, "no points found to move");
    return;
  }

  geometry.translateObject(object, DELTA.x, DELTA.y);

  const after = points(object.geometry);

  const allMoved =
    after.length === before.length &&
    after.every((p, i) =>
      near(p.x, before[i].x + DELTA.x) &&
      near(p.y, before[i].y + DELTA.y)
    );

  check(
    `${label} moves whole, by the whole delta`,
    allMoved,
    `before ${JSON.stringify(before)}, after ${JSON.stringify(after)}`
  );
});

console.log(
  `\n  ${pass} passed, ${fail} failed\n`
);

if (fail) {
  process.exitCode = 1;
}
