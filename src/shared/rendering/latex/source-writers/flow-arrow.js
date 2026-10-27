/*
 * ============================================================
 * THE FLOW ARROW AS TIKZ
 * ============================================================
 *
 * A flow arrow is written as one closed arrowhead about its anchor ON its host
 * pipe's centreline. The compiled picture is the shape the canvas draws
 * (entities/draw-fluids.js) because both derive from the attachment in one
 * place: the model's own `describeFlowArrow`.
 *
 * ============================================================
 * THE HOST REFERENCE IS A COMMENT, NOT A COORDINATE
 * ============================================================
 *
 * The anchor is DERIVED from the host pipe's current geometry every read, so
 * writing its coordinates would freeze them: the compiled arrow would stay in
 * place while the pipe moved, and the source would describe a different shape
 * from the sheet. Instead the arrow's TikZ places the head about an anchor
 * coordinate computed AT REGENERATION, and the host pipe's stable ID is stated
 * in the comment above the commands — the same convention the object-comments
 * layer establishes for every editable object.
 *
 * Reverse Direction and the appearance settings are represented in the source
 * through the arrow's own style options, the same way the other Fluids features
 * state theirs — so an edit made in the panel reaches the source, and an edit
 * made in the source reaches the sheet.
 */
import { point, splitPrelude, styleOptions } from "./statics-primitives.js";
import { applyObjectComments, ensureObjectId } from "../object-comments.js";
import enggFlowArrow from "../../../../features/workspace/model/fluids/flow-arrow.js";

function finitePoint(at) {
  return (
    Boolean(at) &&
    Number.isFinite(Number(at.x)) &&
    Number.isFinite(Number(at.y))
  );
}

function number(value) {
  const rounded = Number(Number(value).toFixed(4));

  return Number.isFinite(rounded) ? String(rounded) : "0";
}

function styleOf(object) {
  const { definitions, options } = splitPrelude(
    styleOptions(object.style || {}),
  );

  return { definitions, options: options.length ? options : ["draw=black"] };
}

function withDefinitions(definitions, commands) {
  const body = commands.filter(Boolean);

  if (!body.length) {
    return null;
  }

  return [...definitions, ...body].join("\n");
}

function serializeFlowArrow(object) {
  const resolved = enggFlowArrow.describeFlowArrow(object);

  if (!resolved.anchor || !resolved.direction) {
    return null;
  }

  const { definitions, options } = styleOf(object);

  const size = resolved.size;
  const half = size / 2;
  const tipLength = size;

  const axis = resolved.direction;
  const across = { x: -axis.y, y: axis.x };

  const at = (along, acrossAmount) => ({
    x: resolved.anchor.x + axis.x * along + across.x * acrossAmount,
    y: resolved.anchor.y + axis.y * along + across.y * acrossAmount,
  });

  /* The same head the tool previews and the canvas draws. */
  const tip = at(half, 0);
  const barbFirst = at(-tipLength / 2, half);
  const barbSecond = at(-tipLength / 2, -half);

  const points = [tip, barbFirst, barbSecond];

  if (points.some((corner) => !finitePoint(corner))) {
    return null;
  }

  const path = points.map((corner) => point(corner.x, corner.y)).join(" -- ");

  return withDefinitions(definitions, [
    `\\draw[${options.join(", ")}] ${path} -- cycle;`,
  ]);
}

export function flowArrowSourceWriter(object) {
  if (!enggFlowArrow.isFlowArrowType(object?.type)) {
    return null;
  }

  const written = serializeFlowArrow(object);

  if (typeof written !== "string" || !written.trim()) {
    return null;
  }

  const id = ensureObjectId(object, enggFlowArrow.FLOW_ARROW_TYPE);

  /*
   * THE COMMENT NAMES THE TYPE, THE NAME AND THE HOST. The host pipe's stable
   * ID is stated here so a regeneration can reattach the arrow to the right
   * segment, and so the source reads as "an arrow on that run" rather than a
   * set of free coordinates.
   */
  return applyObjectComments({ ...object, id }, written, {
    type: enggFlowArrow.FLOW_ARROW_TYPE,
  });
}

export const FLOW_ARROW_SOURCE_TYPES = Object.freeze([
  enggFlowArrow.FLOW_ARROW_TYPE,
]);

export default {
  FLOW_ARROW_SOURCE_TYPES,
  flowArrowSourceWriter,
};
