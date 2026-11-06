/*
 * ============================================================
 * RESIZING A RECTANGLE FROM ONE OF ITS HANDLES
 * ============================================================
 *
 * ONE implementation, used by the Rectangle tool and by a Rigid Body. The two
 * are the same geometry - a box with a position, a size and an angle - so they
 * must resize the same way; a second copy is a second thing to get wrong.
 *
 * THE OPPOSITE EDGE (OR CORNER) IS THE ANCHOR. Dragging a side moves THAT side
 * and leaves the one across from it exactly where it was: the box grows or
 * shrinks by the amount dragged, and its centre moves by half of it. It does not
 * scale about the centre - that is what made the far edge travel with the near
 * one.
 *
 * THE HANDLE POSITIONS FOLLOW THE ROTATION. A body turned 30 degrees has its
 * four corners turned too, so the pointer is first taken INTO the box's own
 * frame (un-rotated about the centre), the resize is done there in plain x and y,
 * and the new box is turned back. Resizing a rotated rectangle therefore keeps
 * its angle: nothing here writes `rotation = 0`.
 *
 * FLIPPING IS PREVENTED, NOT PERFORMED. A handle dragged past its opposite edge
 * is clamped at the model's minimum size, so the box cannot turn itself inside
 * out or mirror.
 */

/* The model's floor, in drawing units. */
export const MIN_BOX_SIZE = 0.5;

/* A box as its four corners, in the object's own rotated frame. */
function boxCorners(position, width, height, rotationDegrees) {
  const radians = ((Number(rotationDegrees) || 0) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const centre = {
    x: Number(position.x) + Number(width) / 2,
    y: Number(position.y) - Number(height) / 2,
  };

  /*
   * The SAME order `rectangleCorners` uses everywhere else: top-left,
   * top-right, bottom-right, bottom-left, in world space.
   */
  return [
    [-width / 2, height / 2],
    [width / 2, height / 2],
    [width / 2, -height / 2],
    [-width / 2, -height / 2],
  ].map(([dx, dy]) => ({
    x: centre.x + dx * cos - dy * sin,
    y: centre.y + dx * sin + dy * cos,
  }));
}

/* A world point, expressed in the box's un-rotated frame. */
function toBoxFrame(point, centre, rotationDegrees) {
  const radians = (-(Number(rotationDegrees) || 0) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = Number(point.x) - centre.x;
  const dy = Number(point.y) - centre.y;

  return {
    x: centre.x + dx * cos - dy * sin,
    y: centre.y + dx * sin + dy * cos,
  };
}

/**
 * Resize a rectangle from one handle.
 *
 * @param {object} geometry     the stored geometry (position/width/height/rotation)
 * @param {number} handleIndex  0..3 for the corners, top-left first, clockwise
 * @param {{x:number,y:number}} point  the pointer, in world coordinates
 * @returns {{width:number, height:number, position:{x:number,y:number}}|null}
 */
export function resizeBoxFromCorner(geometry, handleIndex, point) {
  if (!geometry || !point) {
    return null;
  }

  const width = Number(geometry.width);
  const height = Number(geometry.height);

  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !geometry.position
  ) {
    return null;
  }

  const rotation = Number(geometry.rotation) || 0;
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  /*
   * WHERE THE BOX IS NOW, IN ITS OWN FRAME. In that frame the box is
   * axis-aligned, so the opposite corner is simply the point across it.
   */
  const centre = {
    x: Number(geometry.position.x) + width / 2,
    y: Number(geometry.position.y) - height / 2,
  };

  const local = toBoxFrame(point, centre, rotation);

  const corners = [
    { x: centre.x - width / 2, y: centre.y + height / 2 },
    { x: centre.x + width / 2, y: centre.y + height / 2 },
    { x: centre.x + width / 2, y: centre.y - height / 2 },
    { x: centre.x - width / 2, y: centre.y - height / 2 },
  ];

  const opposite = corners[(handleIndex + 2) % 4];

  /* The dragged corner, clamped so the box can never invert. */
  const moving = {
    x:
      handleIndex === 1 || handleIndex === 2
        ? Math.max(local.x, opposite.x + MIN_BOX_SIZE)
        : Math.min(local.x, opposite.x - MIN_BOX_SIZE),
    y:
      handleIndex === 0 || handleIndex === 1
        ? Math.max(local.y, opposite.y + MIN_BOX_SIZE)
        : Math.min(local.y, opposite.y - MIN_BOX_SIZE),
  };

  const nextWidth = Math.abs(moving.x - opposite.x);
  const nextHeight = Math.abs(moving.y - opposite.y);

  /* The box's centre, still in its own frame. */
  const nextCentre = {
    x: (moving.x + opposite.x) / 2,
    y: (moving.y + opposite.y) / 2,
  };

  /* Back into the world, then back into the stored top-left anchor. */
  const worldCentre = {
    x:
      centre.x +
      (nextCentre.x - centre.x) * cos -
      (nextCentre.y - centre.y) * sin,
    y:
      centre.y +
      (nextCentre.x - centre.x) * sin +
      (nextCentre.y - centre.y) * cos,
  };

  return {
    width: nextWidth,
    height: nextHeight,
    position: {
      x: worldCentre.x - nextWidth / 2,
      y: worldCentre.y + nextHeight / 2,
    },
  };
}

/**
 * Resize a rectangle from one of its SIDES.
 *
 * The side handles are not drawn for a plain rectangle today, but the rule is
 * the same one and it is stated here so a side grip added later cannot invent a
 * symmetric behaviour: the opposite side stays put.
 *
 * @param {"top"|"right"|"bottom"|"left"} side
 */
export function resizeBoxFromSide(geometry, side, point) {
  if (!geometry || !point) {
    return null;
  }

  const width = Number(geometry.width);
  const height = Number(geometry.height);

  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !geometry.position
  ) {
    return null;
  }

  const rotation = Number(geometry.rotation) || 0;
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  const centre = {
    x: Number(geometry.position.x) + width / 2,
    y: Number(geometry.position.y) - height / 2,
  };

  const local = toBoxFrame(point, centre, rotation);
  const left = centre.x - width / 2;
  const right = centre.x + width / 2;
  const top = centre.y + height / 2;
  const bottom = centre.y - height / 2;

  let nextLeft = left;
  let nextRight = right;
  let nextTop = top;
  let nextBottom = bottom;

  if (side === "left") {
    nextLeft = Math.min(local.x, right - MIN_BOX_SIZE);
  } else if (side === "right") {
    nextRight = Math.max(local.x, left + MIN_BOX_SIZE);
  } else if (side === "top") {
    nextTop = Math.max(local.y, bottom + MIN_BOX_SIZE);
  } else if (side === "bottom") {
    nextBottom = Math.min(local.y, top - MIN_BOX_SIZE);
  } else {
    return null;
  }

  const nextWidth = Math.abs(nextRight - nextLeft);
  const nextHeight = Math.abs(nextTop - nextBottom);
  const nextCentre = {
    x: (nextLeft + nextRight) / 2,
    y: (nextTop + nextBottom) / 2,
  };

  const worldCentre = {
    x:
      centre.x +
      (nextCentre.x - centre.x) * cos -
      (nextCentre.y - centre.y) * sin,
    y:
      centre.y +
      (nextCentre.x - centre.x) * sin +
      (nextCentre.y - centre.y) * cos,
  };

  return {
    width: nextWidth,
    height: nextHeight,
    position: {
      x: worldCentre.x - nextWidth / 2,
      y: worldCentre.y + nextHeight / 2,
    },
  };
}

export default {
  MIN_BOX_SIZE,
  boxCorners,
  resizeBoxFromCorner,
  resizeBoxFromSide,
};
