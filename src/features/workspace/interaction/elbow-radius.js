/*
 * ========================================================
 * THE BEND RADIUS - ONE OPERATION, ONE GEOMETRY
 * ========================================================
 *
 * EVERY way a bend's radius can change goes through `applyElbowRadius`: the
 * Features tab's Bend Radius field, the radius handle on the canvas, and any
 * transform that resizes a bend. They used to be three separate paths, and
 * they disagreed:
 *
 *   - the PANEL clamped with `adjustedBendRadius`, which measured the arms from
 *     the elbow's own stored previous/next - the runs' FAR points - rather than
 *     the runs the fitting actually joins;
 *   - the HANDLE clamped the same way but started from a "minimum" instead of
 *     the radius the bend has, so its answer depended on the pointer;
 *   - and NEITHER rewrote the joined runs' trims, seats or seams. A run seated
 *     on a tangent keeps the trim it was last cut for, so a canvas that draws
 *     walls from that record shows the OLD bend's walls beside the NEW arc.
 *
 * So the whole operation lives here: one clamp measured from the live runs, one
 * write of the radius, one regeneration of the trim, the tangent points and the
 * wall seams of every joined run, and one ROLLBACK if any of it cannot be
 * built. The panel supplies an absolute radius, the handle the radius its
 * pointer implies - and for the same radius and angle the result is identical.
 */
import enggPipeDuct from "../model/fluids/pipe-duct.js";
import { drawingState } from "../editor-state.js";

/* Supplied by the tool at start-up, which owns the regeneration routines. */
const collaborators = {
  applyManualElbowConnections: null,
  applyTrimTo: null,
  reseatElbowPipes: null,
  writeSeams: null,
  updateElbowForPair: null
};

export function setElbowRadiusCollaborators(next = {}) {
  Object.keys(collaborators).forEach((key) => {
    if (typeof next[key] === "function") {
      collaborators[key] = next[key];
    }
  });
}

/* The runs a fitting joins, in `connections` order, resolved on the sheet. */
export function elbowRunsOnSheet(elbow, objects = drawingState.objects) {
  const ids = elbow?.engineering?.connections;

  if (!Array.isArray(ids)) {
    return [null, null];
  }

  return [0, 1].map((index) =>
    ids[index] ? (objects || []).find((object) => object.id === ids[index]) || null : null
  );
}

/*
 * THE ROOM EACH ARM HAS, from the bend's CORNER to the far end of the run on
 * that arm.
 *
 * THE FAR END IS THE FIXED ONE. A radius change never moves a run's outer
 * endpoint - only its tangent end - so corner-to-far-end is a CONSTANT for the
 * whole operation, and the largest radius a bend holds is
 *
 *     R = L / tan(A / 2)
 *
 * because a bend of radius R eats `t = R * tan(A / 2)` along each arm.
 *
 * Measuring the run's STORED LENGTH instead - only what the old trim left -
 * makes the limit depend on the radius already set, so a clamp creeps by its
 * own tangent distance on every change and can collapse a pipe to nothing.
 *
 * A fitting with no runs (a manual bend drawn before its pipes) falls back to
 * its own two ends.
 */
export function elbowLiveLegs(elbow, objects = drawingState.objects) {
  const corner = elbow?.geometry?.position;

  if (!corner) {
    return null;
  }

  const [first, second] = elbowRunsOnSheet(elbow, objects);

  const toFarEnd = (run) => {
    if (!run?.geometry) {
      return null;
    }

    const held = elbow?.engineering?.ports?.[run.id];

    if (held !== "start" && held !== "end") {
      return null;
    }

    const far = run.geometry[held === "end" ? "start" : "end"];

    return far ? Math.hypot(far.x - corner.x, far.y - corner.y) : null;
  };

  const ownEnd = (point) =>
    point ? Math.hypot(point.x - corner.x, point.y - corner.y) : null;

  const incoming = toFarEnd(first) ?? ownEnd(elbow?.geometry?.previous);
  const outgoing = toFarEnd(second) ?? ownEnd(elbow?.geometry?.next);

  if (!Number.isFinite(incoming) || !Number.isFinite(outgoing)) {
    return null;
  }

  return { incoming, outgoing };
}

/*
 * THE LARGEST RADIUS THIS BEND CAN HOLD, from its own arms and angle.
 *
 * A corner whose arms are shorter than the smallest drawable bend has no valid
 * radius at all and answers null, so a caller leaves the last valid geometry
 * exactly as it is.
 */
export function elbowMaxBendRadius(elbow, legs = null) {
  const room = legs || elbowLiveLegs(elbow);

  if (!room) {
    return null;
  }

  const shortest = Math.min(room.incoming, room.outgoing);

  if (!(shortest > 1e-9)) {
    return null;
  }

  const angle = enggPipeDuct.elbowAngleDegrees(elbow);

  if (angle === null || !(angle > 1e-9) || angle >= 180) {
    return null;
  }

  const tangent = Math.tan((angle * Math.PI) / 360);

  if (!(tangent > 1e-9)) {
    return null;
  }

  const limit = shortest / tangent;

  if (!Number.isFinite(limit) || limit < enggPipeDuct.MINIMUM_BEND_RADIUS) {
    return null;
  }

  return limit;
}

/*
 * APPLY A BEND RADIUS - THE ONE OPERATION BOTH THE PANEL AND THE HANDLE USE.
 *
 * `radius` is an ABSOLUTE bend radius in drawing units. It is clamped to what
 * the bend's live arms can hold, written, and then every piece of geometry that
 * depends on it is regenerated together:
 *
 *     the fitting's own tangent points and arc
 *     each joined run's held end, trim and wall seam
 *     each joined run's FAR end, which is never touched
 *     the physical connections either side
 *
 * The bend's ANGLE, connections, width transitions and appearance are never
 * altered here: a radius change is a radius change.
 *
 * Returns `{ radius, applied, clamped }` on success, and null when nothing
 * valid can be written - in which case every object is restored and the
 * caller's last valid state is left exactly as it was.
 */
export function applyElbowRadius(elbow, radius, options = {}) {
  if (!elbow || !enggPipeDuct.isElbowType(elbow.type)) {
    return null;
  }

  const objects = options.objects || drawingState.objects;
  const want = Number(radius);

  if (!Number.isFinite(want) || want <= 0) {
    return null;
  }

  const before = JSON.parse(JSON.stringify(elbow));

  const runsBefore = elbowRunsOnSheet(elbow, objects).map((run) =>
    run ? { id: run.id, geometry: JSON.parse(JSON.stringify(run.geometry || {})) } : null
  );

  const restore = () => {
    Object.assign(elbow, JSON.parse(JSON.stringify(before)));

    runsBefore.forEach((saved) => {
      if (!saved) {
        return;
      }

      const run = (objects || []).find((object) => object.id === saved.id);

      if (run) {
        run.geometry = JSON.parse(JSON.stringify(saved.geometry));
      }
    });

    return null;
  };

  const previousRadius = Number(elbow.engineering?.bendRadius);

  /*
   * THE LIMIT THAT DRAWS, NOT MERELY THE LIMIT THE ARMS ALLOW.
   *
   * `elbowMaxBendRadius` is the arms' answer; `elbowFitRadius` is that answer
   * narrowed to a radius whose arc builds, which is what a clamp may write.
   * They differ only for a fitting whose ends are its own.
   */
  const room = elbowLiveLegs(elbow, objects);
  const armLimit = elbowMaxBendRadius(elbow, room);
  const limit =
    armLimit === null
      ? null
      : enggPipeDuct.elbowFitRadius(elbow, room) ?? armLimit;

  /* No bend can be drawn here: keep the last valid geometry. */
  if (limit === null) {
    return null;
  }

  /*
   * A RADIUS READ OFF THE CANVAS IS ROUNDED TO THE MODEL'S PRECISION.
   *
   * The handle's radius comes from a coordinate that has been through the
   * camera transform, so an intended 18 can arrive as 17.999996. Storing that
   * would make a dragged radius differ from a typed one in its last bits, and
   * every dependent value - trim, tangent points, the source - would carry the
   * difference. A billionth of a drawing unit is far below anything visible.
   */
  const clamped = Math.max(
    enggPipeDuct.MINIMUM_BEND_RADIUS,
    Math.min(limit, want)
  );
  /*
   * THE ROUNDING MUST NOT PUSH IT BACK OVER THE LIMIT.
   *
   * Rounding to the model's precision - in EITHER direction - can step across
   * the clamp: up, and a bend whose ends are its own cannot draw; down, and a
   * radius the panel and the handle both asked for lands a billionth short. So
   * the value is rounded FIRST and then clamped, which leaves it exact whenever
   * it fits and inside the limit when it does not.
   */
  const accepted = Math.max(
    enggPipeDuct.MINIMUM_BEND_RADIUS,
    Math.min(limit, Math.round(clamped * 1e9) / 1e9)
  );

  if (
    !enggPipeDuct.setBendRadius(elbow, accepted, {
      user: options.user !== false
    })
  ) {
    return restore();
  }

  /*
   * THE FITTING'S OWN SHAPE, AT THE NEW RADIUS.
   *
   * Its arms' DIRECTIONS are what the arc is tangent to and they do not move,
   * so only the radius is new. A MANUAL fitting re-solves its corner from the
   * ends the student set, and its joined pipes take their trims and seams from
   * THAT - the one routine that does it. A GENERATED one has no ends of its
   * own: its arc comes from `elbowCurvesFor`, and what is written here is the
   * runs' side of the joint.
   */
  if (elbow.engineering?.generated === false) {
    /*
     * A MANUAL FITTING RE-SOLVES ITS CORNER, THEN RE-SEATS.
     *
     * `setElbowAngle` is the one routine that re-places a manual corner from
     * its two ends at the angle it already has, so the bend is re-derived
     * against the NEW radius without moving the ends the student set.
     */
    const manualAngle = enggPipeDuct.elbowAngleDegrees(elbow);

    if (manualAngle !== null) {
      enggPipeDuct.setElbowAngle(elbow, manualAngle);
    }

    collaborators.applyManualElbowConnections?.(elbow, objects);
  } else {
    const curves = enggPipeDuct.elbowCurvesFor(elbow);

    if (!curves) {
      return restore();
    }

    collaborators.applyTrimTo?.(elbow, objects, null);
    collaborators.reseatElbowPipes?.(elbow, objects, curves);
    collaborators.writeSeams?.(elbow, objects, curves);
  }

  const seated = enggPipeDuct.elbowCurvesFor(elbow);

  /*
   * A GENERATED FITTING'S ARC IS THE JOINT, so it must still build. A MANUAL
   * one is exempt: its arc is between its own fixed ends, and a radius at the
   * limit the arms allow may not draw until an end moves. The limit already
   * states the largest bend those ends can hold.
   */
  if (!seated && elbow.engineering?.generated !== false) {
    return restore();
  }

  /*
   * THE TRIM AND THE ARM LIMITS, WHEN THE ARC BUILT. Those are what a later
   * settle reads, and the run's SPAN is deliberately left alone: it remembers
   * both ends as they were drawn, which is what `restoreRunSpan` needs.
   */
  if (seated) {
    elbow.engineering = {
      ...(elbow.engineering || {}),
      bendTrim: seated.trim,
      armLimits: {
        incoming: Math.hypot(
          seated.position.x - seated.start.x,
          seated.position.y - seated.start.y
        ),
        outgoing: Math.hypot(
          seated.position.x - seated.end.x,
          seated.position.y - seated.end.y
        )
      }
    };
  }

  /*
   * AND THE JOINTS EITHER SIDE STAY JOINTS. Re-settling the pair proves the
   * corner is still there at the new radius and leaves the physical
   * connections untouched - a radius change never connects or detaches.
   */
  if (
    options.settleConnections !== false &&
    elbow.engineering?.generated !== false
  ) {
    collaborators.updateElbowForPair?.(elbow, null, null, null, objects);
  }

  /* A last proof: a generated fitting's arc must still build. */
  if (
    elbow.engineering?.generated !== false &&
    !enggPipeDuct.elbowCurvesFor(elbow)
  ) {
    return restore();
  }

  const finalRadius = Number(elbow.engineering.bendRadius);

  return {
    radius: finalRadius,
    applied:
      finalRadius -
      (Number.isFinite(previousRadius) ? previousRadius : finalRadius),
    clamped: Math.abs(finalRadius - want) > 1e-9
  };
}
