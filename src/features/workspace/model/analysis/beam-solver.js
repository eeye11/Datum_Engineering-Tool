/*
 * ========================================================
 * THE BEAM SOLVER
 * ========================================================
 *
 * Computes support reactions and the internal shear, bending moment and axial
 * force along a straight member from the loads and supports ACTUALLY attached
 * to it. This is the calculation engine behind SFD, BMD and AFD.
 *
 * WHAT IT SOLVES, AND WHAT IT REFUSES
 * -----------------------------------
 *
 * It solves the PLANAR, STATICALLY DETERMINATE beam: a single straight member
 * carrying point forces, applied couples and distributed loads, restrained by
 * a combination of supports whose reactions are determinate.
 *
 * It REFUSES - by returning a status with a reason rather than numbers - when:
 *
 *   - the body is not a straight member with a measurable length;
 *   - the supports do not make the beam statically determinate (no supports,
 *     too few reaction components, or more than three);
 *   - a support's reaction direction cannot be established;
 *   - a load's direction is unknown;
 *   - the reactions do not come out finite.
 *
 * A refusal is the honest outcome. Producing a plausible-looking curve for a
 * structure the model cannot solve would be inventing the answer, which is the
 * one thing an engineering tool must never do.
 *
 * SIGN CONVENTIONS (stated once, used everywhere)
 * ----------------------------------------------
 *   World axes     x to the right, y up.
 *   Forces         positive x right, positive y up.
 *   Moments        positive anticlockwise.
 *   Beam axis      measured from the member's START towards its END, so
 *                  `x` below is the DISTANCE ALONG the member, not world x.
 *   Shear V        positive when the left-hand face of a cut is pushed UP by
 *                  the material to its right (the sagging convention), which
 *                  is the convention a bending-moment diagram is drawn with.
 *   Moment M       positive sagging (tension on the underside).
 *   Axial N        positive in TENSION.
 *
 * DISTANCES. Everything is in the model's own drawing length units. Because
 * a beam can be drawn at any angle, every point is projected onto the member's
 * own axis, so a load at a fraction along the beam is a load at the same
 * fraction whether the beam is level or sloping.
 */

/*
 * A tolerance for "on the member". Fractions are clamped to [0, 1] and a load
 * a hair outside is treated as at the end rather than discarded.
 */
const TOLERANCE = 1e-6;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/* ============================================================
 * THE MEMBER FRAME
 * ============================================================ */

/*
 * The member's own axis, in world coordinates.
 *
 * `start`, `end`, `length`, `ux`/`uy` (the unit vector from start to end) and
 * `nx`/`ny` (its anticlockwise normal). Every projection below is expressed in
 * this frame, so a sloping member is handled by the same arithmetic as a level
 * one.
 *
 * Returns null when the member has no measurable length, which is the one
 * condition under which none of the projections mean anything.
 */
export function memberFrame(body) {
  const g = body?.geometry;

  const start = g?.start;
  const end = g?.end;

  if (
    !start ||
    !end ||
    !Number.isFinite(start.x) ||
    !Number.isFinite(start.y) ||
    !Number.isFinite(end.x) ||
    !Number.isFinite(end.y)
  ) {
    return null;
  }

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);

  if (!(length > TOLERANCE)) {
    return null;
  }

  return {
    start: { x: start.x, y: start.y },
    end: { x: end.x, y: end.y },
    length,
    ux: dx / length,
    uy: dy / length,
    nx: -dy / length,
    ny: dx / length,
  };
}

/*
 * The distance ALONG the member of a world point, clamped to the member.
 */
export function distanceAlong(frame, point) {
  if (!frame || !point) {
    return 0;
  }

  const projection =
    (point.x - frame.start.x) * frame.ux + (point.y - frame.start.y) * frame.uy;

  return Math.min(frame.length, Math.max(0, projection));
}

/*
 * A world point resolved into components ALONG and ACROSS the member.
 *
 * Given the member's start as the origin, a vector (vx, vy) in world space
 * becomes (along, across): its projection on the member's axis and its
 * projection on the member's normal.
 */
export function vectorInFrame(frame, vx, vy) {
  return {
    along: vx * frame.ux + vy * frame.uy,
    across: vx * frame.nx + vy * frame.ny,
  };
}

/* ============================================================
 * SUPPORT REACTIONS
 * ============================================================ */

/*
 * The reaction unknowns a support contributes.
 *
 * The four support kinds restrain different degrees of freedom:
 *
 *   pin     two components - along and across the member - at its station
 *   roller  one component, ACROSS the support surface (which is the member's
 *           normal when the roller sits under a level beam)
 *   smooth  the same as a roller: a normal reaction, no friction
 *   fixed   two components AND a moment at its station
 *
 * The reaction is stated in the MEMBER's frame, because that is the frame the
 * beam equations are written in. A vertical world force on a sloping beam is
 * therefore split into along/across components correctly.
 *
 * Returns null when the reaction direction cannot be established.
 */
function reactionsForSupport(support, frame) {
  const geometry = support?.geometry || {};

  const station = distanceAlong(frame, supportPoint(support, geometry));

  if (support.type === "fixed-support") {
    return {
      station,
      along: true,
      across: true,
      moment: true,
    };
  }

  if (support.type === "pin-support") {
    return {
      station,
      along: true,
      across: true,
      moment: false,
    };
  }

  /*
   * A roller and a smooth support both react NORMAL TO THEIR SURFACE. For a
   * roller lying under a level beam that is the vertical direction; when
   * the student rotates the roller, it is that rotated normal. The stored
   * `orientation` is the support symbol's own angle, and the surface normal
   * is square to it - which is the direction the symbol's "surface" faces.
   *
   * The ACROSS direction of the member is the default, and it is what the
   * ordinary case (a roller under a beam) means. A rotated roller is taken
   * as still reacting across the member unless its orientation is a real
   * number, in which case the normal of that orientation is used.
   */
  const orientation = Number(geometry.orientation);

  if (Number.isFinite(orientation) && Math.abs(orientation) > 0.001) {
    const radians = (orientation * Math.PI) / 180;

    return {
      station,
      along: false,
      across: true,
      moment: false,
      direction: {
        x: -Math.sin(radians),
        y: Math.cos(radians),
      },
    };
  }

  return {
    station,
    along: false,
    across: true,
    moment: false,
  };
}

/*
 * Where a support acts, as a world point ON the member.
 *
 * A support stores an attachment (a fraction along its body) as well as a
 * drawn position. The attachment is authoritative: it is what survives the
 * member being moved or resized. A support with no attachment falls back to
 * its drawn position, which is the only thing an older file has.
 */
function supportPoint(support, geometry) {
  const attachment = geometry?.attachment;

  if (attachment && Number.isFinite(Number(attachment.fraction))) {
    return {
      x: geometry.position?.x ?? 0,
      y: geometry.position?.y ?? 0,
      fraction: Number(attachment.fraction),
    };
  }

  return geometry?.position || null;
}

/*
 * The station (distance along the member) a support reacts at.
 *
 * Re-resolved here so an attachment stored as a fraction is measured against
 * the member's CURRENT length.
 */
function supportStation(support, frame) {
  const geometry = support?.geometry || {};
  const fraction = Number(geometry.attachment?.fraction);

  if (Number.isFinite(fraction)) {
    return Math.min(1, Math.max(0, fraction)) * frame.length;
  }

  return distanceAlong(frame, geometry.position);
}

/* ============================================================
 * LOADS
 * ============================================================ */

/*
 * A point force as components in the member frame.
 *
 * The force may state a magnitude and an angle, or explicit X/Y components;
 * the components win where both are present, because a student who has typed
 * Fx and Fy means those. Unknown forces are reported, never treated as zero.
 */
function forceComponents(force, frame) {
  const g = force?.geometry || {};

  const fx = Number(g.forceX);
  const fy = Number(g.forceY);

  if (Number.isFinite(fx) && Number.isFinite(fy)) {
    return {
      known: true,
      along: fx * frame.ux + fy * frame.uy,
      across: fx * frame.nx + fy * frame.ny,
    };
  }

  const magnitude = Number(g.magnitude);
  const angle = Number(g.angle);

  if (!Number.isFinite(magnitude) || !Number.isFinite(angle)) {
    return { known: false };
  }

  const radians = (angle * Math.PI) / 180;

  const wx = magnitude * Math.cos(radians);
  const wy = magnitude * Math.sin(radians);

  return {
    known: true,
    along: wx * frame.ux + wy * frame.uy,
    across: wx * frame.nx + wy * frame.ny,
  };
}

/*
 * The per-unit-length intensity of a distributed load, resolved into the
 * member frame.
 *
 * A uniform load stores one intensity; a varying load stores a start and an
 * end intensity and is trapezoidal between them. The intensity is a force per
 * unit length ACROSS the member, so it contributes to the shear; only an
 * applied axial intensity would add to the axial force, and DAETUM's
 * distributed loads do not model that, so this returns an across intensity.
 */
function loadIntensity(load, position) {
  const g = load?.geometry || {};

  if (load.type === "varying-load") {
    const start = Math.max(0, finite(g.startIntensity));
    const end = Math.max(0, finite(g.endIntensity));
    const length =
      Math.hypot(
        finite(g.end?.x) - finite(g.start?.x),
        finite(g.end?.y) - finite(g.start?.y),
      ) || 1;

    const t = Math.min(1, Math.max(0, position / length));

    return start + (end - start) * t;
  }

  return Math.max(0, finite(g.intensity));
}

/* ============================================================
 * THE SOLVER
 * ============================================================ */

/*
 * Solve a beam.
 *
 * `body`    the member feature (the beam)
 * `objects` every feature on the sheet; the ones attached to `body` - by
 *           `parentId` or by lying along it - are the loads and supports
 *
 * Returns one of:
 *
 *   { ok: false, reason }                       a structure it cannot solve
 *   { ok: true, frame, reactions, stations,     a solved structure
 *     shearAt, momentAt, axialAt, extrema... }
 *
 * The result is a FUNCTION of the current model: every number in it is read
 * from the objects as they are now, so a recalculation after any edit gives an
 * answer that matches the drawing.
 */
export function solveBeam(body, objects) {
  const frame = memberFrame(body);

  if (!frame) {
    return {
      ok: false,
      reason: "This member has no measurable length, so it cannot be solved.",
    };
  }

  const attached = (objects || []).filter(
    (object) =>
      object && object.id !== body.id && belongsToBody(object, body, frame),
  );

  const supports = attached.filter(isSupport);
  const forces = attached.filter((object) => object.type === "force");
  const moments = attached.filter((object) => object.type === "moment");
  const loads = attached.filter(
    (object) => object.type === "load" || object.type === "varying-load",
  );

  /*
   * UNKNOWN INPUTS ARE REPORTED BEFORE ANY ARITHMETIC. A force with no
   * magnitude and a load with no direction cannot be summed, and silently
   * skipping them would under-count the load and produce a wrong but
   * plausible diagram.
   */
  const unknownForce = forces.find(
    (force) => !forceComponents(force, frame).known,
  );

  if (unknownForce) {
    return {
      ok: false,
      reason:
        `${unknownForce.name || "A force"} has no magnitude or direction, ` +
        "so the diagram cannot be calculated.",
    };
  }

  const unknownLoad = loads.find(
    (load) => load.geometry?.directionUnknown === true,
  );

  if (unknownLoad) {
    return {
      ok: false,
      reason:
        `${unknownLoad.name || "A load"} has no known direction, ` +
        "so the diagram cannot be calculated.",
    };
  }

  /*
   * THE REACTION UNKNOWNS, counted before solving. A planar beam has three
   * equilibrium equations, so at most three independent reaction components
   * can be found. Fewer than three leaves it unstable; more than three is
   * statically indeterminate and this solver will not guess a distribution.
   */
  const supportReactions = supports.map((support) =>
    reactionsForSupport(support, frame),
  );

  const componentCount = supportReactions.reduce(
    (total, reaction) =>
      total + (reaction.along ? 1 : 0) + (reaction.across ? 1 : 0),
    0,
  );

  /*
   * A PURE MOMENT REACTION (a fixed support) does not count towards the
   * translational count; it is an extra unknown. A fixed support therefore
   * contributes 3, and must be the only support for the beam to be
   * determinate. Beyond that, a single extra restraint makes the beam
   * indeterminate.
   */
  const momentReactionCount = supportReactions.filter(
    (reaction) => reaction.moment,
  ).length;

  const totalUnknowns = componentCount + momentReactionCount;

  if (!supports.length) {
    return {
      ok: false,
      reason: "This beam has no supports, so its reactions cannot be found.",
    };
  }

  if (totalUnknowns < 3) {
    return {
      ok: false,
      reason:
        "This beam is not fully supported - it needs three reaction " +
        "components (a pin and a roller, or a fixed end).",
    };
  }

  if (totalUnknowns > 3) {
    return {
      ok: false,
      reason:
        "This beam is statically indeterminate (more than three reaction " +
        "components), which this solver does not calculate.",
    };
  }

  /*
   * THE APPLIED LOAD SYSTEM, as point and distributed contributions.
   */
  const pointLoads = forces.map((force) => {
    const components = forceComponents(force, frame);

    return {
      id: force.id,
      station: distanceAlong(
        frame,
        force.geometry?.start || force.geometry?.position,
      ),
      along: components.along,
      across: components.across,
    };
  });

  const appliedCouples = moments.map((moment) => ({
    id: moment.id,
    station: distanceAlong(frame, moment.geometry?.position),
    /*
     * A moment stores its direction as the WORD "CW" or "CCW". In world
     * terms CCW is positive, CW negative. The beam's transverse equation
     * uses the same sense, because the member frame is a right-handed
     * rotation of the world frame.
     */
    value:
      String(moment.geometry?.direction || "CCW").toUpperCase() === "CW"
        ? -Math.abs(finite(moment.geometry?.magnitude))
        : Math.abs(finite(moment.geometry?.magnitude)),
  }));

  const distributed = loads
    .map((load) => {
      const span = loadSpan(load, frame);

      if (!span) {
        return null;
      }

      return {
        id: load.id,
        ...span,
        intensityAt: (station) => loadIntensity(load, station - span.from),
      };
    })
    .filter(Boolean);

  /*
   * A LOAD'S SUBSCRIPT IS MEASURED IN THE DRAWING'S LENGTH UNITS, while the
   * member's LENGTH is in those same units. Reactions are therefore in the
   * units the forces are in, and moments in force x length - the units the
   * panel already states. No scale conversion is invented here.
   */

  /* ---- EQUILIBRIUM: three equations, three unknowns ---- */

  const reactions = solveReactions({
    frame,
    supportReactions,
    supports,
    pointLoads,
    appliedCouples,
    distributed,
  });

  if (!reactions) {
    return {
      ok: false,
      reason:
        "The support reactions could not be found from the loads on " +
        "this beam.",
    };
  }

  /* ---- INTERNAL FORCES ---- */

  const stations = collectStations(
    frame,
    pointLoads,
    appliedCouples,
    distributed,
  );

  return {
    ok: true,
    frame,
    length: frame.length,
    reactions,
    stations,
    pointLoads,
    appliedCouples,
    distributed,
    shearAt: (station) => shearAt(station, reactions, pointLoads, distributed),
    momentAt: (station) =>
      momentAt(station, reactions, pointLoads, appliedCouples, distributed),
    axialAt: (station) => axialAt(station, reactions, pointLoads),
    extrema: extremaOf(
      frame,
      pointLoads,
      appliedCouples,
      distributed,
      reactions,
    ),
  };
}

/* ============================================================
 * WHICH FEATURES BELONG TO THE MEMBER
 * ============================================================ */

function belongsToBody(object, body, frame) {
  if (object.parentId && object.parentId !== body.id) {
    return false;
  }

  if (object.parentId === body.id) {
    return true;
  }

  /*
   * An unattached load or support still acts on the member it lies on. Only
   * the features that ACT are considered, and only when they sit along the
   * span - never a second beam drawn below it.
   */
  if (!actedOnTypes.has(object.type)) {
    return false;
  }

  const point = object.geometry?.position || object.geometry?.start || null;

  if (!point) {
    return false;
  }

  const projection =
    (point.x - frame.start.x) * frame.ux + (point.y - frame.start.y) * frame.uy;

  const off = Math.abs(
    (point.x - frame.start.x) * frame.nx + (point.y - frame.start.y) * frame.ny,
  );

  const tolerance = Math.max(1, frame.length * 0.001);

  return (
    projection >= -tolerance &&
    projection <= frame.length + tolerance &&
    off <= Math.max(1, frame.length * 0.02)
  );
}

const actedOnTypes = new Set([
  "force",
  "load",
  "varying-load",
  "moment",
  "pin-support",
  "roller-support",
  "fixed-support",
  "smooth-support",
]);

function isSupport(object) {
  return [
    "pin-support",
    "roller-support",
    "fixed-support",
    "smooth-support",
  ].includes(object.type);
}

function loadSpan(load, frame) {
  const g = load.geometry || {};

  if (!g.start || !g.end) {
    return null;
  }

  const from = distanceAlong(frame, g.start);
  const to = distanceAlong(frame, g.end);

  return {
    from: Math.min(from, to),
    to: Math.max(from, to),
  };
}

/* ============================================================
 * REACTIONS
 * ============================================================ */

/*
 * Solve the three equilibrium equations for the reaction components.
 *
 * The equations are written about the member's start as the origin, with
 * distance along the member as x and across as y:
 *
 *   SUM F_along  = 0
 *   SUM F_across = 0
 *   SUM M        = 0   (anticlockwise positive, about the start)
 *
 * The unknowns are the reaction components at the supports. With three
 * unknowns this is a small linear system, solved by Cramer's rule. With a
 * single fixed support all three unknowns sit at one station and the answer is
 * a plain sum, which the same machinery handles.
 *
 * Returns null when the system is singular (the supports cannot be separated).
 */
function solveReactions(input) {
  const {
    frame,
    supportReactions,
    supports,
    pointLoads,
    appliedCouples,
    distributed,
  } = input;

  void frame;

  /* The load resultants, as if each were a single force and moment. */
  const loadAlong = pointLoads.reduce((sum, load) => sum + load.along, 0);

  const loadAcross = pointLoads.reduce((sum, load) => sum + load.across, 0);

  const loadCouples = appliedCouples.reduce(
    (sum, couple) => sum + couple.value,
    0,
  );

  /* Distributed loads contribute a resultant force and a moment. */
  let distributedAlong = 0;
  let distributedAcross = 0;
  let distributedMoment = 0;

  distributed.forEach((load) => {
    const resultant = distributedResultant(load);
    distributedAcross += resultant.force;
    distributedAlong += 0;
    distributedMoment += resultant.moment;
  });

  /*
   * The unknown reaction components. Each support contributes up to three
   * unknowns (along, across, moment), at its station. Each unknown has a
   * direction (a unit vector in the member frame) and a lever arm (its
   * station, since moments are taken about the start).
   */
  const unknowns = [];

  supportReactions.forEach((reaction, index) => {
    const support = supports[index];

    if (reaction.along) {
      unknowns.push({
        support,
        axis: "along",
        station:
          supportStation(support, {
            length: 1,
            ux: 1,
            uy: 0,
            nx: 0,
            ny: 1,
            start: { x: 0, y: 0 },
          }) *
            0 +
          stationFor(support, frameOf(input)),
        unit: { along: 1, across: 0 },
      });
    }

    if (reaction.across) {
      const direction = reaction.direction
        ? {
            along:
              reaction.direction.x * frameOf(input).ux +
              reaction.direction.y * frameOf(input).uy,
            across:
              reaction.direction.x * frameOf(input).nx +
              reaction.direction.y * frameOf(input).ny,
          }
        : { along: 0, across: 1 };

      unknowns.push({
        support,
        axis: "across",
        station: stationFor(support, frameOf(input)),
        unit: direction,
      });
    }

    if (reaction.moment) {
      unknowns.push({
        support,
        axis: "moment",
        station: stationFor(support, frameOf(input)),
        unit: { moment: 1 },
      });
    }
  });

  /*
   * Three equations: along, across, moment. Each unknown contributes a
   * column. The load side is the negative of the applied sums.
   */
  const rows = unknowns.map(() => [0, 0, 0]);

  unknowns.forEach((unknown, column) => {
    if (unknown.unit.moment) {
      // A couple acts on the moment equation only.
      rows[2][column] += 1;
      return;
    }

    // A force acts on its own equilibrium equation and creates a moment.
    if (Math.abs(unknown.unit.along) > TOLERANCE) {
      rows[0][column] += unknown.unit.along;
    }

    if (Math.abs(unknown.unit.across) > TOLERANCE) {
      rows[1][column] += unknown.unit.across;
    }

    rows[2][column] +=
      unknown.station * unknown.unit.across - 0 * unknown.unit.along;
  });

  const rhs = [
    -(loadAlong + distributedAlong),
    -(loadAcross + distributedAcross),
    -(loadCouples + distributedMoment),
  ];

  const solution = solve3x3(rows, rhs);

  if (!solution) {
    return null;
  }

  /*
   * Resolve the solution back into named reaction values per support, in the
   * member frame, so the diagram can draw and label them.
   */
  return supportReactions.map((reaction, index) => {
    const support = supports[index];

    let along = 0;
    let across = 0;
    let moment = 0;

    unknowns.forEach((unknown, column) => {
      if (unknown.support !== support) {
        return;
      }

      const value = solution[column];

      along += unknown.unit.along ? value * unknown.unit.along : 0;

      across += unknown.unit.across ? value * unknown.unit.across : 0;

      moment += unknown.unit.moment ? value : 0;
    });

    return {
      supportId: support.id,
      type: support.type,
      station: stationFor(support, frameOf(input)),
      along,
      across,
      moment,
    };
  });
}

/* The frame is threaded through the input for the projections above. */
function frameOf(input) {
  return input.frame;
}

/* A support's station along the member, against the member's real length. */
function stationFor(support, frame) {
  return supportStation(support, frame);
}

/*
 * The resultant of a distributed load, as a single transverse force and the
 * moment it creates about the member's start.
 *
 * The load is piecewise linear in intensity, so its resultant is found by
 * splitting it at every profile point and summing each trapezium. That is
 * exact for the trapezoidal segments DAETUM stores, rather than a sampling
 * approximation.
 */
function distributedResultant(load) {
  const points = loadProfilePoints(load);

  let force = 0;
  let moment = 0;

  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];

    const width = b.station - a.station;

    if (width <= 0) {
      continue;
    }

    /* The area of a trapezium, and its centroid along the member. */
    const area = (a.intensity + b.intensity) * 0.5 * width;

    const centroid =
      a.station +
      (width * (a.intensity + 2 * b.intensity)) /
        (3 * (a.intensity + b.intensity) || 1);

    force += area;
    moment += area * centroid;
  }

  return { force, moment };
}

/*
 * A distributed load as breakpoints in member stations, so the resultant and
 * the internal-force integrals share one reading of the profile.
 */
function loadProfilePoints(load) {
  const points = [];

  const raw = Array.isArray(load.geometry?.points)
    ? load.geometry.points
    : null;

  if (raw && raw.length) {
    raw
      .filter(
        (point) =>
          point &&
          Number.isFinite(Number(point.t)) &&
          Number.isFinite(Number(point.magnitude)),
      )
      .forEach((point) => {
        points.push({
          station:
            load.from +
            (load.to - load.from) * Math.min(1, Math.max(0, Number(point.t))),
          intensity: Math.max(0, Number(point.magnitude)),
        });
      });

    if (points.length >= 2) {
      return points;
    }
  }

  /*
   * A varying load with a start and end intensity, or a uniform load with a
   * single intensity.
   */
  const startIntensity =
    load.load?.type === "varying-load" || load.intensityAt === undefined
      ? null
      : null;

  void startIntensity;

  if (
    Number.isFinite(Number(load.startIntensity)) ||
    Number.isFinite(Number(load.endIntensity))
  ) {
    return [
      {
        station: load.from,
        intensity: Math.max(0, Number(load.startIntensity) || 0),
      },
      {
        station: load.to,
        intensity: Math.max(0, Number(load.endIntensity) || 0),
      },
    ];
  }

  const intensity = Math.max(0, Number(load.intensity) || 0);

  return [
    { station: load.from, intensity },
    { station: load.to, intensity },
  ];
}

/* ============================================================
 * INTERNAL FORCES (SFD / BMD / AFD)
 * ============================================================ */

/*
 * The shear at a station: the sum of everything to the LEFT of the cut,
 * measured across the member.
 *
 * A point force at the station itself is a discontinuity. The LEFT-HAND value
 * is returned (the limit approaching from below), and the renderer draws the
 * jump as a vertical edge, which is the convention an SFD is read with.
 */
export function shearAt(station, reactions, pointLoads, distributed) {
  let shear = 0;

  reactions.forEach((reaction) => {
    if (reaction.station < station - TOLERANCE) {
      shear += reaction.across;
    }
  });

  pointLoads.forEach((load) => {
    if (load.station < station - TOLERANCE) {
      shear += load.across;
    }
  });

  distributed.forEach((load) => {
    if (load.from < station - TOLERANCE) {
      const to = Math.min(station, load.to);
      shear += distributedArea(load, load.from, to);
    }
  });

  return shear;
}

/*
 * The bending moment at a station: the sum of the moments, about the cut, of
 * everything to the left. Sagging is positive.
 */
export function momentAt(
  station,
  reactions,
  pointLoads,
  appliedCouples,
  distributed,
) {
  let moment = 0;

  reactions.forEach((reaction) => {
    if (reaction.station < station - TOLERANCE) {
      moment += reaction.across * (station - reaction.station);
      moment += reaction.moment;
    }
  });

  pointLoads.forEach((load) => {
    if (load.station < station - TOLERANCE) {
      moment += load.across * (station - load.station);
    }
  });

  appliedCouples.forEach((couple) => {
    if (couple.station < station - TOLERANCE) {
      moment += couple.value;
    }
  });

  distributed.forEach((load) => {
    if (load.from < station - TOLERANCE) {
      const to = Math.min(station, load.to);
      moment += distributedMoment(load, load.from, to);
    }
  });

  return moment;
}

/*
 * The axial force at a station. Tension is positive.
 *
 * A DAETUM distributed load is transverse, so only point forces (and the
 * axial components of reactions) contribute.
 */
export function axialAt(station, reactions, pointLoads) {
  let axial = 0;

  reactions.forEach((reaction) => {
    if (reaction.station < station - TOLERANCE) {
      axial += reaction.along;
    }
  });

  pointLoads.forEach((load) => {
    if (load.station < station - TOLERANCE) {
      axial += load.along;
    }
  });

  return axial;
}

/*
 * The integral of a distributed load's intensity between two stations, and the
 * moment of that strip about the LEFT end of the strip (i.e. about the cut).
 */
function distributedArea(load, from, to) {
  return distributedStrip(load, from, to).force;
}

function distributedMoment(load, from, to) {
  return distributedStrip(load, from, to).moment;
}

function distributedStrip(load, from, to) {
  const points = loadProfilePoints(load);

  let force = 0;
  let moment = 0;

  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];

    const aStation = Math.max(a.station, from);
    const bStation = Math.min(b.station, to);

    const width = bStation - aStation;

    if (width <= 0) {
      continue;
    }

    const span = b.station - a.station || 1;

    const aIntensity =
      a.intensity +
      ((b.intensity - a.intensity) * (aStation - a.station)) / span;

    const bIntensity =
      a.intensity +
      ((b.intensity - a.intensity) * (bStation - a.station)) / span;

    const area = (aIntensity + bIntensity) * 0.5 * width;

    /*
     * The moment is taken about the CUT, not about the member start, so
     * the lever arm is measured from `from`.
     */
    const centroid =
      (width * (aIntensity + 2 * bIntensity)) /
      (3 * (aIntensity + bIntensity) || 1);

    force += area;
    moment += area * (centroid + (aStation - from));
  }

  return { force, moment };
}

/* ============================================================
 * STATIONS AND EXTREMA
 * ============================================================ */

/*
 * Every station where the internal forces can change slope or jump: the ends,
 * every load and support, and the ends of every distributed load. Sorted and
 * de-duplicated.
 */
function collectStations(frame, pointLoads, appliedCouples, distributed) {
  const stations = [0, frame.length];

  pointLoads.forEach((load) => stations.push(load.station));
  appliedCouples.forEach((couple) => stations.push(couple.station));

  distributed.forEach((load) => {
    stations.push(load.from, load.to);
  });

  return stations
    .map((station) => Math.min(frame.length, Math.max(0, station)))
    .sort((a, b) => a - b)
    .filter(
      (station, index, all) =>
        index === 0 || station - all[index - 1] > TOLERANCE,
    );
}

/*
 * The key values of the diagram: the maximum and minimum of the shear and the
 * bending moment, and where the moment crosses zero.
 *
 * The extrema of a piecewise-linear diagram occur at the breakpoints, so
 * sampling at those (and a midpoint of each segment, for a curved segment) is
 * enough to find the largest magnitude.
 */
function extremaOf(frame, pointLoads, appliedCouples, distributed, reactions) {
  const stations = collectStations(
    frame,
    pointLoads,
    appliedCouples,
    distributed,
  );

  const samples = [];

  stations.forEach((station, index) => {
    samples.push(station);

    if (index > 0) {
      samples.push((stations[index - 1] + station) / 2);
    }
  });

  let shearMax = { value: -Infinity, station: 0 };
  let shearMin = { value: Infinity, station: 0 };
  let momentMax = { value: -Infinity, station: 0 };
  let momentMin = { value: Infinity, station: 0 };

  samples.forEach((station) => {
    const shear = shearAt(station, reactions, pointLoads, distributed);

    const moment = momentAt(
      station,
      reactions,
      pointLoads,
      appliedCouples,
      distributed,
    );

    if (shear > shearMax.value) {
      shearMax = { value: shear, station };
    }

    if (shear < shearMin.value) {
      shearMin = { value: shear, station };
    }

    if (moment > momentMax.value) {
      momentMax = { value: moment, station };
    }

    if (moment < momentMin.value) {
      momentMin = { value: moment, station };
    }
  });

  return {
    shearMax,
    shearMin,
    momentMax,
    momentMin,
  };
}

/* ============================================================
 * LINEAR ALGEBRA
 * ============================================================ */

/*
 * Solve a 3x3 system by Cramer's rule.
 *
 * The system is small and explicitly three-dimensional, so Cramer's rule is
 * both readable and exact. A determinant at floating-point zero means the
 * supports do not separate the unknowns - a beam on one roller, or two
 * rollers at the same place - and the caller reports that rather than
 * dividing by it.
 */
export function solve3x3(matrix, rhs) {
  const det = determinant3(matrix);

  const scale = Math.max(
    1,
    Math.abs(matrix[0][0]) + Math.abs(matrix[1][1]) + Math.abs(matrix[2][2]),
  );

  if (!Number.isFinite(det) || Math.abs(det) < 1e-9 * scale) {
    return null;
  }

  const result = [0, 0, 0];

  for (let column = 0; column < 3; column += 1) {
    const replaced = matrix.map((row, index) =>
      row.map((value, at) => (at === column ? rhs[index] : value)),
    );

    result[column] = determinant3(replaced) / det;

    if (!Number.isFinite(result[column])) {
      return null;
    }
  }

  return result;
}

function determinant3(m) {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  );
}

/* ============================================================
 * A DRAWABLE SAMPLING OF ONE DIAGRAM
 * ============================================================ */

/*
 * The ordinates of a diagram, sampled along the member, ready to draw.
 *
 * `quantity` is "shear", "moment" or "axial". The result is a list of
 * `{ station, value }` pairs at every breakpoint plus a midpoint of each
 * segment, which is enough to draw the linear runs exactly and to show the
 * curvature of a loaded segment.
 */
export function sampleDiagram(solution, quantity) {
  if (!solution?.ok) {
    return [];
  }

  const stations = solution.stations;
  const samples = [];

  stations.forEach((station, index) => {
    samples.push(station);

    if (index > 0) {
      samples.push((stations[index - 1] + station) / 2);
    }
  });

  const read = (station) => {
    if (quantity === "moment") {
      return solution.momentAt(station);
    }

    if (quantity === "axial") {
      return solution.axialAt(station);
    }

    return solution.shearAt(station);
  };

  return samples.map((station) => ({
    station,
    value: read(station),
  }));
}

const enggBeamSolver = {
  memberFrame,
  distanceAlong,
  vectorInFrame,
  solveBeam,
  sampleDiagram,
  shearAt,
  momentAt,
  axialAt,
  solve3x3,
};

export default enggBeamSolver;
