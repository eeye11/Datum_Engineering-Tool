/*
 * ============================================================
 * THE FLUIDS SOURCE READERS
 * ============================================================
 *
 * The reader half of the Fluids source pipeline. A writer answers "what does
 * this object look like in TikZ?"; a reader answers the reverse question for
 * the objects whose source carries MORE than a shape - the ones DAETUM must be
 * able to rebuild from what the student typed.
 *
 * The Flow Arrow is the first Fluids object that needs one. Its picture is a
 * closed arrowhead, which the generic shape reader would take for a triangle:
 * the geometry of the head is not the arrow's model, and the head's three
 * corners alone cannot say WHICH PIPE the arrow belongs to, how far along it it
 * sits, whether it points with the run, or how big it is. Those are stated in
 * the block's DAETUM comments - the same metadata lines the writer emits - and
 * this module reads them back.
 *
 * WHAT IS READ, AND FROM WHERE
 *
 *   hostId     `% DAETUM HOST: <pipe id>`       - the pipe's stable id
 *   position   `% DAETUM ALONG: <fraction>`     - 0..1 along that pipe
 *   reversed   `% DAETUM DIRECTION: reverse`    - absent or "along" is forward
 *   size       the head's own three corners     - measured, not trusted
 *   style      the `\draw` options              - colour, dash and width
 *
 * THE SIZE IS MEASURED. The corners are in the student's own source, so the
 * size is the distance from a barb to the tip - which means a hand-edited
 * head whose size no longer matches its metadata is read as it is DRAWN, and
 * the arrow that comes back is the arrow in the picture.
 *
 * RETURNS null, NEVER A GUESS. A block without a host, without a usable
 * position, or with a path that is not an arrowhead is declined, and the block
 * is reported by the ordinary reader as unrecognised. The object keeps its last
 * valid form - it is never moved to a host the source does not name.
 */

import enggFlowArrow from "../../../../features/workspace/model/fluids/flow-arrow.js";
import { POINTS_PER_LINE_WIDTH } from "../../../../tool-library/shared/primitives/tikz-style.js";

/* The metadata fields this reader understands, beyond the shared header. */
export const FLOW_ARROW_FIELDS = Object.freeze({
  attach: "ATTACH",
  host: "HOST",
  along: "ALONG",
  direction: "DIRECTION"
});

/* One metadata line, as `{ field, value }` - or null when it is not one. */
const METADATA = /^[ \t]*%[ \t]*DAETUM[ \t]+([A-Z]+)[ \t]*:[ \t]*(.*?)[ \t]*$/;

function metadataOf(source) {
  const fields = {};

  String(source ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .forEach((line) => {
      const match = METADATA.exec(line);

      if (!match) {
        return;
      }

      fields[String(match[1]).toUpperCase()] = match[2];
    });

  return fields;
}

/* The `\draw[...]` and `\fill[...]` option lists on their own, in order. */
function commandOptions(source) {
  return [...String(source ?? "").matchAll(/\\(?:draw|fill)\s*\[([^\]]*)\]/g)].map((match) =>
    match[1]
      .split(",")
      .map((option) => option.trim())
      .filter(Boolean)
  );
}

/* The coordinates of every `( x , y )` in the source, in order. */
function coordinatesOf(source) {
  return [...String(source ?? "").matchAll(/\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/g)].map(
    (match) => ({ x: Number(match[1]), y: Number(match[2]) })
  );
}

/*
 * THE ARROW'S STATEMENTS, SPLIT BY THE COMMAND THEY BELONG TO.
 *
 * An arrow is written as TWO commands - the shaft line and the head - and they
 * are told apart by what they draw, not by their order: the OPEN path through
 * two points is the shaft, the CLOSED path through three is the head. Reading
 * them separately is what lets a hand-edited head be measured from its own
 * corners while the shaft's length is read from its own line.
 */
function statementsOf(source) {
  return [...String(source ?? "").matchAll(/\\(?:draw|fill|filldraw)\s*(?:\[[^\]]*\])?\s*([^;]*);/g)].map(
    (match) => ({
      body: match[1],
      closed: /--\s*cycle/.test(match[1]),
      points: coordinatesOf(match[1])
    })
  );
}

/*
 * THE STYLE A WRITTEN ARROW CARRIES.
 *
 * The writer states the dash pattern, the line width and the ink as TikZ
 * options. Each is mapped back to the model's own vocabulary, so a student who
 * types `dashed` or names a width gets the control that value belongs to -
 * and a block that states nothing keeps whatever appearance it had.
 *
 * A COLOUR THE MODEL CANNOT NAME IS NOT INVENTED. `\definecolor{...}{RGB}{r,g,b}`
 * is the writer's own prelude, so a name it defines is read back as that hex;
 * `black` is the drawing's own default; a colour definition this reader does not
 * recognise leaves the stroke alone rather than guessing a hex from a name.
 */
function styleFromSource(source, previousStyle = {}) {
  const style = { ...previousStyle };

  const definitions = new Map();

  String(source ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .forEach((line) => {
      const html = /^[ \t]*\\definecolor\{([^}]*)\}\{HTML\}\{([0-9A-Fa-f]{6})\}/.exec(line);

      if (html) {
        definitions.set(html[1].trim(), `#${html[2].toUpperCase()}`.toLowerCase());
        return;
      }

      const rgb = /^[ \t]*\\definecolor\{([^}]*)\}\{RGB\}\{(\d+),(\d+),(\d+)\}/.exec(line);

      if (rgb) {
        const hex = [rgb[2], rgb[3], rgb[4]]
          .map((channel) => Math.max(0, Math.min(255, Number(channel))).toString(16).padStart(2, "0"))
          .join("");

        definitions.set(rgb[1].trim(), `#${hex}`.toLowerCase());
      }
    });

  commandOptions(source).forEach((options) => {
    options.forEach((option) => {
      const [key, rawValue] = option.split("=").map((part) => part.trim());
      const value = (rawValue || "").trim();

      if (key === "dashed" || key === "dash dot") {
        style.lineType = key === "dashed" ? "dashed" : "dash-dot";
        return;
      }

      if (key === "dotted") {
        style.lineType = "dotted";
        return;
      }

      if (key === "dash pattern") {
        /*
         * A HAND-WRITTEN PATTERN. A very short dash is what "dotted" is drawn
         * with, so it is read as dotted; anything else is dashed, which is the
         * nearest state the control offers.
         */
        const numbers = value.match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
        const first = numbers.find((number) => number > 0) || 1;

        style.lineType = first <= 0.5 ? "dotted" : "dashed";
        return;
      }

      if (key === "solid") {
        style.lineType = "solid";
        return;
      }

      if (key === "line width") {
        /*
         * TIKZ WIDTHS ARE PHYSICAL: `0.4pt`, `1.2pt`. The model's Thickness is
         * a nominal multiple of the standard pen, which is the same conversion
         * `source-object-sync.js` uses for a line - inverted here so a width
         * written and read back is the same width.
         *
         * A DASH OR DOT PATTERN CARRIES ITS OWN `line width` INSIDE
         * `dash pattern=on 3pt off 3pt`. Those numbers are the dash lengths, not
         * the pen, so a statement that states the pen explicitly wins over one
         * this reader met inside a pattern.
         */
        const points = Number((value.match(/-?\d+(?:\.\d+)?/) || [])[0]);

        if (Number.isFinite(points) && points > 0) {
          style.lineWidth = Number((points / POINTS_PER_LINE_WIDTH).toFixed(3));
        }

        return;
      }

      if (key === "draw") {
        const named = definitions.get(value);

        if (named) {
          style.stroke = named;
        } else if (value.toLowerCase() === "black" || value.toLowerCase() === "none") {
          style.stroke = value.toLowerCase() === "black" ? "#000000" : "none";
        }
      }

      if (key === "fill") {
        const named = definitions.get(value) || (value.toLowerCase() === "black" ? "#000000" : null);

        if (named) {
          style.headingFill = named;
          style.headingFillMode = "solid";
        }
      }
    });
  });

  return style;
}

/*
 * THE ARROW'S HEAD AND SHAFT, FROM ITS OWN COMMANDS.
 *
 * The shaft is the OPEN two-point path; the head is the CLOSED three-point
 * path. Both are needed: the head gives the arrow's direction and its
 * proportions, and the shaft gives its LENGTH - which is what makes the size
 * read back as the same number the model wrote.
 *
 * A BLOCK THAT IS ONLY A CLOSED TRIANGLE IS STILL UNDERSTOOD, as an arrow
 * written before the shaft existed: its length is taken from the head's own
 * share, so a document saved by the older writer still opens as an arrow.
 *
 * Returns `{ centre, tipIndex, headLength, size }`, or null when the block has
 * no three-cornered head at all.
 */
function headOf(source) {
  const statements = statementsOf(source);

  const headStatement = statements.find((statement) => statement.closed && statement.points.length >= 3);

  const shaftStatement = statements.find((statement) => !statement.closed && statement.points.length === 2);

  if (!headStatement) {
    return null;
  }

  const points = headStatement.points.slice(0, 3);

  /*
   * THE TIP IS THE CORNER FARTHEST FROM ITS NEIGHBOUR'S MIDPOINT - for the
   * symmetric head this reader's writer produces, that is unambiguously the
   * point that stands alone across from the two barbs.
   */
  const scores = points.map((corner, index) => {
    const other = points.filter((_, position) => position !== index);
    const midpoint = {
      x: (other[0].x + other[1].x) / 2,
      y: (other[0].y + other[1].y) / 2
    };

    return Math.hypot(corner.x - midpoint.x, corner.y - midpoint.y);
  });

  const tipIndex = scores.indexOf(Math.max(...scores));

  const others = points.filter((_, position) => position !== tipIndex);

  const tip = points[tipIndex];

  /*
   * THE HEAD'S LENGTH IS ALONG THE ARROW'S AXIS. The barbs stand either side of
   * the axis, so the distance to a barb is a DIAGONAL and always longer than the
   * head; it is the AXIAL distance - tip to the midpoint of the barbs - that a
   * head is measured by, and the number the writer drew.
   */
  const headBase = { x: (others[0].x + others[1].x) / 2, y: (others[0].y + others[1].y) / 2 };

  const headLength = Math.hypot(tip.x - headBase.x, tip.y - headBase.y);

  /*
   * THE HEAD'S LENGTH IS ONE QUARTER OF THE ARROW, so an arrow's own length is
   * four of them - and that is what the model's `size` means. When a shaft is
   * present it is measured instead, which keeps a hand-edited arrow readable at
   * whatever length it was actually drawn.
   */
  const size = shaftStatement
    ? Math.hypot(
        shaftStatement.points[1].x - shaftStatement.points[0].x,
        shaftStatement.points[1].y - shaftStatement.points[0].y
      ) + headLength
    : headLength / enggFlowArrow.HEAD_SHARE;

  return {
    centre: {
      x: (points[0].x + points[1].x + points[2].x) / 3,
      y: (points[0].y + points[1].y + points[2].y) / 3
    },
    tipIndex,
    headLength,
    size
  };
}

/*
 * READ A FLOW ARROW FROM ITS BLOCK.
 *
 * `previous` is the object the block already belongs to, when there is one: its
 * style is kept for every property the source does not state, and its id is
 * returned with the result so the block keeps describing the same object.
 *
 * Returns `{ type, hostId, fraction, reversed, size, style, centre }`, or null.
 */
export function readFlowArrow(source, { previous = null, hostExists = () => true } = {}) {
  const fields = metadataOf(source);

  /*
   * THE COMPACT FORM FIRST, the three-line form as a fallback.
   *
   * `ATTACH: <host>@<fraction>:<direction>` is what the writer emits now; a
   * document saved before it carries `HOST`, `ALONG` and `DIRECTION` as three
   * lines. Both are read, so an older file opens as the arrow it describes
   * rather than falling through to "not a shape DAETUM can edit".
   */
  const attached = String(fields.ATTACH ?? "").trim();

  const parsed = attached ? /^(.*)@([^:]*):(.*)$/.exec(attached) : null;

  const hostId = String(parsed ? parsed[1] : (fields.HOST ?? "")).trim();

  if (!hostId) {
    return null;
  }

  const fraction = Number(parsed ? parsed[2] : fields.ALONG);

  if (!Number.isFinite(fraction)) {
    return null;
  }

  /*
   * THE HOST MUST BE A PIPE THIS DRAWING HAS. A typed arrow naming a pipe that
   * is not there has nothing to be attached to, so it is declined and reported
   * like any other unreadable block - rather than being invented as an arrow
   * floating at its written coordinates with no host.
   */
  if (!hostExists(hostId)) {
    return null;
  }

  const head = headOf(source);

  if (!head) {
    return null;
  }

  const direction = String(parsed ? parsed[3] : (fields.DIRECTION ?? "")).trim().toLowerCase();

  return {
    type: "flow-arrow",
    hostId,
    fraction: Math.min(0.95, Math.max(0.05, fraction)),
    reversed: direction === "reverse" || direction === "reversed" || direction === "against",
    size: head.size,
    style: styleFromSource(source, previous?.style || {}),
    centre: head.centre,
    id: previous?.id || null
  };
}

export default {
  FLOW_ARROW_FIELDS,
  readFlowArrow
};
