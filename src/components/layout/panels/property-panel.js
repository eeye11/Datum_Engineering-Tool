/*
 * ========================================================
 * THE SHARED FEATURE-PANEL VOCABULARY
 * ========================================================
 *
 * Every feature panel in DAETUM is the same argument told about different
 * engineering objects: what is this, what does it act on, what does it
 * measure, where is it, how is it drawn. That argument has a shape, and the
 * shape is not a matter of taste - it is what lets a student who has just
 * edited a beam read a Distributed Load panel without re-learning it.
 *
 * ========================================================
 * WHY THIS IS A MODULE AND NOT A CONVENTION
 * ========================================================
 *
 * The panels were not merely inconsistent; they were inconsistent in ways
 * nobody chose. Each renderer defined its own local `section`, `field`,
 * `toggle`, `readOnly` and `number` closures - fifteen near-copies of the same
 * five functions, each drifting. Two of them rounded differently. One appended
 * a unit with a trailing space whether or not a unit was passed. One built a
 * coordinate pair by string-concatenating two numbers with a comma and
 * appending "mm" to the pair, which is how a panel came to show
 *
 *     Start
 *     150, 300 mm
 *
 * and how an absent value came to leave a bare separator behind. A rule
 * followed by fifteen people is not a rule. It is fifteen decisions waiting to
 * disagree, and the punctuation was the first thing that showed it.
 *
 * So the components live here, once. A feature panel declares WHICH fields it
 * has; this module decides how every one of them looks, behaves, handles a
 * missing value, and is spaced. The feature type determines the fields. This
 * module determines everything else.
 *
 * ========================================================
 * THE TWO INVARIANTS THIS ENFORCES
 * ========================================================
 *
 * 1. NO PUNCTUATION WITHOUT A VALUE. Every text-bearing component here passes
 *    through `text()`, which drops the whole field when there is nothing to
 *    say and never emits a label with an empty value after it. A missing
 *    quantity cannot become "Direction: ," because a field with no value is
 *    not a field. This is enforced in the data-to-display layer, not hidden
 *    with CSS - the markup is not produced in the first place.
 *
 * 2. NO EMPTY SECTIONS. `section()` is buffered, not pushed. A heading whose
 *    body turned out to contain nothing is not emitted at all, so there is no
 *    APPEARANCE heading over nothing, and no leftover gap where one was
 *    removed. Sections are also ordered by construction, not by whichever
 *    feature happened to push first.
 */
/*
 * ====================================================
 * THE TEXT RULE
 * ====================================================
 *
 * One gate for every string that reaches a panel. It answers the only
 * question that produces stray punctuation: is there actually a value here?
 *
 * The checks are ordered cheapest and most-likely first. `undefined`,
 * `null` and `NaN` are the three ways a value goes missing in practice, and
 * all three stringify to something that looks like content - "undefined",
 * "null", "NaN" - which is exactly why they have to be caught rather than
 * rendered and squinted at.
 */
const MISSING = new Set([
  undefined,
  null,
]);

const isMissing = value =>
  MISSING.has(value) ||
  (typeof value === "number" && !Number.isFinite(value));

/*
 * The text a component will actually display, or null if it has nothing
 * worth displaying.
 *
 * A zero is a value. `!value` would discard it, which is how a legitimately
 * zero shear or a zero-length offset comes to vanish from its own panel;
 * only a genuinely absent quantity goes.
 */
const text = value => {
  if (isMissing(value)) {
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    return trimmed === "" ? null : trimmed;
  }

  if (
      typeof value === "object" &&
      value !== null
  ) {
      /*
       * An object that reached the display layer unformatted. Rendering it
       * would produce "[object Object]" - the clearest possible sign that
       * formatting was skipped. It is treated as missing rather than
       * shipped, because a panel showing that has a bug, not a value.
       */
      return null;
  }

  return String(value);
};

const escape = value =>
  String(value).replace(
    /[&<>"']/g,
    character =>
      ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
      })[character],
  );

/*
 * ====================================================
 * NUMBER FORMATTING, DECIDED ONCE
 * ====================================================
 *
 * The panels disagreed about decimals - some at two places, some at none -
 * so a student reading a value across two panels could not tell whether the
 * difference was engineering or display. Trailing zeros are dropped: they
 * add width without adding information, and they are what makes a panel look
 * ragged when values are listed one under another.
 *
 * Negative zero is normalised, because it is a real value rounded from
 * something smaller than it can represent and "-0" is not a number a student
 * should be asked to interpret.
 */
const number = (value, places = 2) => {
  if (isMissing(value)) {
    return "";
  }

  const rounded = Number(
      Number(value).toFixed(places),
  );

  if (Object.is(rounded, -0)) {
    return "0";
  }

  return String(rounded);
};

/*
 * ====================================================
 * A QUANTITY: NUMBER AND UNIT, AS ONE FIELD
 * ====================================================
 *
 * `value` and `unit` are joined here and nowhere else. A panel cannot
 * produce "100 NN" or "250 mm mm" by forgetting that one of them already
 * had a unit on it, because no panel builds a quantity string itself.
 *
 * Returns null when there is no number - a field whose value is missing is
 * not rendered with a unit and no number, which is the shape that produces
 * orphan punctuation.
 */
const quantity = (value, unit = "") => {
  const amount = text(number(value));

  if (amount === null) {
    return null;
  }

  const suffix = text(unit);

  return suffix ? `${amount} ${suffix}` : amount;
};

/*
 * ====================================================
 * THE BASE ROW
 * ====================================================
 *
 * The one layout every field in DAETUM's property panels shares: a label, a
 * value or control, an optional unit, and an optional trailing slot for the
 * small state controls (constraint tick, unknown marker) that sit after the
 * unit so the reading order is always Label -> Value -> Unit -> State.
 *
 * The four-cell grid is kept even when the later cells are empty, because
 * the CSS grid columns are shared across rows: dropping a cell would shift
 * every field below it out of alignment with the fields above, which is
 * worse than an empty span. The empty spans are structural, not stray
 * output - they never contain punctuation.
 */
const row = ({
  label,
  control,
  unit = "",
  state = "",
  classes = "",
  /**
   * THE VALUE-ADJACENT CONTROL GROUP.
   *
   * Some rows carry a small control that belongs to the VALUE, not to the
   * row's trailing state column - the `?` Unknown toggle is the one: it says
   * something about the number itself, so it sits immediately beside the
   * unit, in the same cell, on the same line.
   *
   * This slot is trusted HTML: callers hand over a control they built with
   * the panel's own helpers. It is deliberately distinct from `state`, which
   * holds the row's trailing checkbox in its own fixed track - the two
   * tracks are laid out independently, and a control in the wrong one gets
   * pushed out of line or wrapped to a second row.
   */
  unitExtra = "",
}) => {
  const caption = text(label);

  /*
   * A row with no label cannot be read and a row with no control has
   * nothing in it. Neither is a field; neither is rendered.
   */
  if (
      caption === null ||
      !control
  ) {
      return null;
  }

  return `
        <div class="drawing-property-grid drawing-property-grid-value${classes ? ` ${classes}` : ""}">
            <span class="drawing-property-grid-label">${escape(caption)}</span>
            ${control}
            <span class="drawing-property-unit">${escape(text(unit) || "")}${unitExtra || ""}</span>
            ${state || "<span></span>"}
        </div>
    `;
};

/*
 * ====================================================
 * FIELD COMPONENTS
 * ====================================================
 */

/*
 * A value the student reads but cannot type. Derived quantities, counts and
 * references live here - Resultant's magnitude, Force Components' Fx and Fy,
 * how many source forces a Resultant has. They are computed from the
 * engineering model on every repaint, so offering an input would invite the
 * student to edit a number that the model will immediately overwrite.
 */
const readOnly = (label, value, unit = "", classes = "") => {
  const shown = text(value);

  if (shown === null) {
    return null;
  }

  return row({
    label,
    control: `<span class="drawing-property-derived">${escape(shown)}</span>`,
    unit,
    classes,
  });
};

/*
 * A quantity the student reads and cannot type, carrying its unit. Routed
 * through `quantity` so the number/unit join happens in one place.
 */
const readOnlyQuantity = (
  label,
  value,
  unit = "",
  classes = "",
) => {
  const shown = quantity(value, unit);

  if (shown === null) {
    return null;
  }

  return row({
    label,
    control: `<span class="drawing-property-derived">${escape(shown)}</span>`,
    unit: "",
    classes,
  });
};

/*
 * An editable engineering number.
 *
 * `key` is what the change is applied to. It is required, because an input
 * with no key is an input the student can type into that does nothing -
 * which reads as a broken panel rather than an absent feature.
 *
 * `disabled` covers the three states that are not the student's to change
 * right now: a value pinned by a constraint, a value that is genuinely
 * unknown, and a value derived from the model. They are reported
 * differently in the trailing slot, but the input itself behaves the same,
 * so a disabled field always looks the same however it became disabled.
 */
const scalar = ({
  label,
  key,
  value,
  unit = "",
  disabled = false,
  state = "",
  classes = "",
  unitExtra = "",

  /**
   * A CONTROL FOR THE UNIT ITSELF.
   *
   * A unit-bearing field may offer a selector so the student can read (and
   * enter) the value in another unit of the same quantity - mm or inches, a
   * force in N or kN. It belongs to the UNIT, so it shares that cell rather
   * than taking a track of its own; a selector in the wrong track pushes the
   * row out of line.
   *
   * It is merged into `unitExtra` because that slot exists for precisely this
   * - a control belonging to the value or its unit, on the value's own line -
   * and a second slot with the same meaning would be a second thing to place
   * correctly. When both are given, the unit control comes last so it sits
   * against the number it describes.
   */
  unitControl = "",
}) => {
  if (!key) {
    return null;
  }

  /*
   * AN EDITABLE FIELD WITH NO VALUE IS ALSO NOT A FIELD.
   *
   * The obvious case - no number in the box - is handled by the caller
   * omitting it. But a field whose value is missing entirely renders as
   *
   *     Magnitude   [     ]  N
   *
   * an empty input beside a unit, which is the same complaint as
   * "Direction: ," one level down: a label and a unit describing nothing.
   * The value is absent here, so the field that would display it is absent
   * too. The alternative - rendering it empty and disabled so the student
   * can see there is nothing there yet - is reserved for the deliberate
   * "not yet specified" state, which is a real state and says so on the
   * field; an absent value is not that.
   */
  if (isMissing(value)) {
    return null;
  }

  const amount = number(value);

  const control = disabled
    ? `<span class="drawing-property-readonly">${escape(amount)}</span>`
    : `<input type="number" step="any"
            data-property="${escape(key)}"
            class="drawing-property-input"
            aria-label="${escape(label)}"
            value="${escape(amount)}">`;

  return row({
    label,
    control,
    unit,
    unitExtra: `${unitExtra || ""}${unitControl || ""}`,
    state: disabled ? state || "" : state,
    classes,
  });
};

/*
 * A choice between named options, shown as one dropdown.
 *
 * The options are described, not pre-selected: a panel says what Line Type
 * CAN be, and the current value is marked within that list. Hard-coding a
 * `<select>` per line type is how "Solid / Dashed / Dotted" ends up
 * duplicated across fifteen panels with three different orderings.
 */
const select = ({
  label,
  attribute,
  options,
  value,
  disabled = false,
  state = "",
  classes = "",
}) => {
  const choices = (options || [])
    .map(option => {
      const optionText = text(
          typeof option === "object"
              ? option.label
              : option,
      );

      const optionValue =
          typeof option === "object"
              ? option.value
              : option;

      if (optionText === null) {
        return "";
      }

      const selected =
          String(optionValue) === String(value);

      return `<option value="${escape(optionValue)}"${selected ? " selected" : ""}>${escape(optionText)}</option>`;
    })
    .join("");

  if (!choices) {
    return null;
  }

  const control = `<select class="drawing-property-select"
            ${attribute}="${escape(attribute)}"
            aria-label="${escape(label)}"
            ${disabled ? "disabled" : ""}>${choices}</select>`;

  return row({
    label,
    control,
    unit: "",
    state,
    classes,
  });
};

/*
 * A boolean, as a checkbox.
 *
 * `on` is coerced rather than tested for truthiness of a possibly-"false"
 * string, so a setting stored as the string "false" reads as off instead of
 * on - the failure mode of a toggle that is permanently on and cannot be
 * explained.
 */
const toggle = ({
  label,
  attribute,
  on = false,
  state = "",
  classes = "",
}) => {
  if (!attribute) {
    return null;
  }

  const enabled = on === true || on === "true";

  const control = `<input type="checkbox"
            ${attribute}="${escape(attribute)}"
            aria-label="${escape(label)}"
            ${enabled ? "checked" : ""}>`;

  return row({
    label,
    control,
    unit: "",
    state,
    classes,
  });
};

/*
 * ====================================================
 * THE UNIT SELECTOR, DECIDED ONCE
 * ====================================================
 *
 * A unit-bearing quantity - a force, a moment, a distributed load, a length -
 * shows its unit as a SELECT beside the number, so the student can read the
 * unit AND change it without leaving the Features panel.
 *
 * It is built here, once, and every panel uses this one control. That is what
 * makes the unit selector the same width, the same type size, the same
 * dropdown and the same keyboard behaviour on a Point Force, a Moment, a
 * Distributed Load and a Dimension: a rule followed by hand is a rule that
 * drifts, and the drift is invisible in any single panel.
 *
 * THE WIDTH IS A FLOOR, NOT A FIT. The shared `drawing-property-unit-select`
 * class reserves enough room for the longest engineering unit the tables
 * contain - `kg\u00b7m/s\u00b2`, `kN\u00b7m`, `lbf\u00b7ft` - so a selected unit is
 * never clipped, never shows an ellipsis and never has its own dropdown arrow
 * sitting over the text. The font is the panel's normal size; the field is
 * widened rather than the type shrunk, because a unit a student cannot read is
 * a unit they cannot trust.
 *
 * The value beside it is a separate control: the CALLER decides whether that
 * is an editable input with a unit, or a derived reading. This component owns
 * only the unit half of the pair.
 */
const unitSelect = ({
  property,
  units,
  current,
  label = "Unit",
  disabled = false,
  classes = "",
}) => {
  const choices = (units || [])
    .map(unit => {
      const optionText = text(unit);

      if (optionText === null) {
        return "";
      }

      const selected = String(unit) === String(current);

      return `<option value="${escape(unit)}"${selected ? " selected" : ""}>${escape(optionText)}</option>`;
    })
    .join("");

  if (!choices) {
    return "";
  }

  return `<select
        class="drawing-property-unit-select${classes ? ` ${classes}` : ""}"
        data-property="${escape(property)}"
        aria-label="${escape(label)}"
        title="${escape(label)}"
        ${disabled ? "disabled" : ""}>${choices}</select>`;
};

/*
 * A control that acts rather than describes: a button, a link to an editor.
 *
 * It is a row rather than a bare button so it keeps the panel's label
 * column and cannot drift left into the margin where it reads as sheet
 * furniture rather than as part of this feature.
 */
const action = ({
  label,
  attribute,
  value,
  classes = "",
}) => {
  if (!label || !attribute) {
    return null;
  }

  const control = `<button type="button"
            class="drawing-property-action"
            ${attribute}="${escape(attribute)}"
            data-action-value="${escape(value ?? "")}">${escape(label)}</button>`;

  return row({
    label: "",
    control,
    classes,
  });
};

/*
 * A pair of coordinates.
 *
 * Two fields, not one. The defect this replaces built "150, 300 mm" by
 * concatenating two numbers with a comma and appending the unit to the pair,
 * so the unit appeared to belong to the second number, the value could not
 * be edited or read as a position, and a missing ordinate left a dangling
 * separator. X and Y are separate quantities and are shown separately.
 */
const coordinate = ({
  label,
  xKey,
  yKey,
  x,
  y,
  unit = "mm",
  disabled = false,
}) => {
  return [
      scalar({
          label: `${label} X`,
          key: xKey,
          value: x,
          unit,
          disabled,
      }),
      scalar({
          label: `${label} Y`,
          key: yKey,
          value: y,
          unit,
          disabled,
      }),
  ].filter(Boolean);
};

/*
 * ====================================================
 * SECTIONS
 * ====================================================
 *
 * A section is a buffer, not a string. Fields are added to it; when it is
 * closed it either produces a heading followed by those fields, or nothing
 * at all.
 *
 * This is the mechanism behind "no empty sections". A feature whose
 * particular configuration has no appearance properties never writes one,
 * and cannot accidentally render a heading over nothing - the heading and
 * the fields that justify it are created together or not at all.
 */
const section = (label, fields) => {
  const caption = text(label);

  const body = (fields || [])
    .flat(Infinity)
    .filter(
      field =>
        typeof field === "string" &&
        field.trim() !== "",
    )
    .join("");

  if (body === "") {
    return "";
  }

  /*
   * A heading is optional, but only because a field may be rendered
   * directly - in a panel that supplies its own heading, or a group inside
   * a larger one. It is not optional to decide whether the fields are worth
   * rendering, which is what the check above has already done.
   */
  if (caption === null) {
    return body;
  }

  return `
        <div class="drawing-properties-section">${escape(caption)}</div>
        ${body}
    `;
};

/*
 * ====================================================
 * THE PANEL
 * ====================================================
 *
 * Assembles sections in ONE fixed order, whatever order they were declared
 * in. A panel that pushed POSITION before APPEARANCE because that feature
 * happened to compute its position first would otherwise look different from
 * its neighbour for no reason a student could name.
 *
 * The order is the reading order of the object itself:
 *
 *   what it is -> what it measures -> what it acts on -> what is shown
 *   -> what is written on it -> where it is -> how it is drawn
 *
 * "What it is" is the header, which `header()` supplies, and it carries the
 * editable name. The rest are the sections below.
 */
const SECTION_ORDER = [
  "engineering",
  "reference",
  "display",
  "annotation",
  "position",
  "appearance",
];

/*
 * The title of the panel: the feature's own name, in the type case DAETUM
 * uses for headings.
 *
 * This is the user-facing name and never the internal type. "analysis-
 * diagram" is an implementation detail; "SFD 1" is what the student calls
 * the thing they made.
 */
const header = name => {
  const caption = text(name);

  if (caption === null) {
    return "";
  }

  return `<div class="drawing-properties-title">${escape(caption)}</div>`;
};

/*
 * The editable name.
 *
 * Separate from the header because they answer different questions - the
 * header says what this is, the field says what the student has called it -
 * and because the field needs a hook to be editable at all.
 *
 * `attribute` is the bare hook name ("feature-name") and becomes
 * `data-feature-name`, so the control a panel is built from and the code
 * that listens for it are decided together and cannot drift apart.
 *
 * The name is bound by its own attribute rather than by a geometry key
 * because a feature's name is not part of its geometry: it does not travel
 * in the geometry signature, and typing in the box must not be mistaken for
 * an edit to the shape.
 */
const nameField = ({
  label = "Feature Name",
  attribute,
  value,
}) => {
  const hook = text(attribute);

  if (hook === null) {
    return null;
  }

  const shown = text(value);

  return row({
    label,
    control: `<input type="text"
            data-${escape(hook)}="${escape(hook)}"
            class="drawing-property-input"
            aria-label="${escape(label)}"
            value="${escape(shown === null ? "" : shown)}">`,
  });
};

const panel = ({
  name,
  sections = {},
  classes = "",
}) => {
  /*
   * Sections in the canonical order, then anything a feature declared that
   * is not one of the standard ones, so a genuinely feature-specific group
   * still appears rather than being silently dropped.
   */
  const ordered = SECTION_ORDER.map(
      key => [key, sections[key]],
  ).filter(([, fields]) => fields);

  const extras = Object.entries(sections)
      .filter(([key]) => !SECTION_ORDER.includes(key));

  const body = [...ordered, ...extras]
      .map(([, fields]) =>
          Array.isArray(fields)
              ? fields.filter(Boolean).join("")
              : fields || "",
      )
      .join("");

  return `
        <div class="drawing-properties-panel${classes ? ` ${classes}` : ""}">
            ${header(name)}
            ${body}
        </div>
    `;
};

const enggPropertyPanel = {
  /*
   * The text gate, exported because a feature assembling a compound value
   * (a coordinate, a range, a list of names) needs the same protection
   * against rendering an absent piece as punctuation.
   */
  text,
  number,
  quantity,

  section,
  panel,
  header,
  nameField,

  row,
  readOnly,
  readOnlyQuantity,
  scalar,
  coordinate,
  select,
  unitSelect,
  toggle,
  action,
};

export default enggPropertyPanel;
