/*
 * The Annotation object.
 *
 * An annotation DESCRIBES something. A dimension measures it. That is
 * the whole distinction this system turns on, and this module is the
 * other half of it:
 *
 *     "how long is this beam"      -> a Dimension
 *     "250 N at 30 degrees"        -> an Annotation
 *     "assume negligible self-weight"  -> an Annotation
 *
 * So nothing here computes a length, and nothing in the dimension
 * module computes a force. A Point Force has a magnitude, a direction
 * and an application point, and they are three different kinds of
 * fact: the point is geometry and can be dimensioned, while the
 * magnitude and direction are engineering values that only exist
 * because the student put them there. This module states them; it never
 * derives them.
 *
 * ---------------------------------------------------------------------------
 * THE ONE THING THIS MODULE EXISTS TO GET RIGHT
 * ---------------------------------------------------------------------------
 *
 * An annotation is a LABEL ATTACHED TO A FEATURE, not a child of it.
 * The student must be able to grab "250 N" and drag it to the other
 * side of the sheet while the force arrow stays exactly where it was,
 * and the label must keep updating from the force afterwards:
 *
 *     Point Force            Annotation "250 N"
 *          \                 at x = 300, y = 150
 *           \
 *            \                sourceFeatureId: pointForce_004
 *             *
 *
 * Move the annotation to x = 450, y = 100. The force does not move.
 * The annotation still says 250 N because it still points at the
 * force. Change the force to 300 N and the annotation says 300 N,
 * still at x = 450, because the student put it there and that choice
 * is theirs.
 *
 * Two properties, therefore, that must never be confused:
 *
 *     sourceFeatureId     WHO the annotation is about
 *     placement           WHERE the annotation sits
 *
 * Moving the annotation changes the second and must not touch the
 * first. Changing the source's value changes what the annotation SAYS
 * and must not touch the second. Conflating them is the failure this
 * module's whole design exists to prevent, so placement is stored with
 * an explicit record of whether the student chose it - and a placement
 * the student chose is never moved again on their behalf.
 *
 * ---------------------------------------------------------------------------
 * GENERATED VERSUS WRITTEN
 * ---------------------------------------------------------------------------
 *
 * A GENERATED annotation derives its text from the feature: a force's
 * magnitude, a moment's sense, a support's name. Change the feature
 * and the text follows, because the text is not stored - it is read
 * from the feature every time it is asked for, the same way a
 * dimension's value is measured rather than remembered.
 *
 * A WRITTEN annotation is the student's own words. "Assume negligible
 * self-weight" is not derived from anything, so editing it is normal
 * text editing and moving it does nothing to any feature.
 *
 * Both keep their text separate from their placement, so a written
 * annotation that the student has positioned still does not become
 * associated with anything just by being near it.
 */
import enggMeasurement from "../../../../shared/geometry/measurement-core.js";
import enggLoadProfile from "../analysis/load-profile.js";
import { CONNECTION_TYPES, SUPPORT_TYPES } from "../../../../shared/model/feature-types.js";

/*
 * ========================================================
 * ANNOTATION KINDS
 * ========================================================
 */

/*
 * The kinds of annotation, and what each is attached to.
 *
 * `generated` is the load-bearing field. A generated annotation has
 * its text read from its feature and is therefore always in step
 * with it; a written one has text of its own and is never in step
 * with anything. A kind that is not generated must be treated as
 * written - an absent flag must never mean "associate it anyway",
 * because that would make a student's own note start rewriting
 * itself when a nearby force is edited.
 */
/*
 * The label kinds, and what each one is able to talk about.
 *
 * `describes` is the honest answer to "may this label be written on

 * this feature". It is declared here rather than worked out from the data,

 * because the data alone is not enough: a moment has a magnitude just as
 * a force does, and probing for one alone would happily label a moment

 * "F = 500 N", which calls a moment a force and means it.

 * So a kind states what it describes, and kindsFor offers only those.

 * A new feature type opts in by naming itself here - in one place, next to

 * the label - rather than by editing the tool that offers them.

 */
const KINDS = {
  "free-text": {
    label: "Note",
    generated: false
  },
  label: {
    label: "Label",
    generated: false
  },
  caption: {
    label: "Caption",
    generated: false
  },
  "force-value": {
    label: "Force value",
    generated: true,
    describes: ["force", "resultant"]
  },
  "force-components": {
    label: "Force components",
    generated: true,
    describes: ["force", "resultant", "force-components"]
  },
  "moment-value": {
    label: "Moment value",
    generated: true,
    describes: ["moment"]
  },
  "load-value": {
    label: "Load value",
    generated: true,
    describes: ["load"]
  },
  "load-profile-value": {
    label: "Profile value",
    generated: true,
    describes: ["varying-load"]
  },
  "support-label": {
    label: "Support label",
    generated: true,
    describes: SUPPORT_TYPES
  },
  "connection-label": {
    label: "Connection label",
    generated: true,
    describes: CONNECTION_TYPES
  },
  "resultant-value": {
    label: "Resultant value",
    generated: true,
    describes: ["force", "resultant"]
  }
};

function isGenerated(kind) {
  return KINDS[kind]?.generated === true;
}

/*
 * ========================================================
 * THE FEATURE TYPES THAT CARRY SOMETHING WORTH ANNOTATING
 * ========================================================
 *
 * Read off the KINDS table rather than kept as a second list.
 *
 * The table is the authority: it already says, per kind, which feature types
 * that kind describes, and it is what decides whether a box can be produced
 * for a feature at all. A list written anywhere else is a list that can fall
 * behind - and it did, immediately: a list naming "distributed-load" and
 * "moment" would offer the switch to features DAETUM does not have
 * (they are "load" and "moment") and so offer it to nothing at all, while
 * omitting the support and connection labels the table does carry.
 *
 * Two questions are deliberately NOT answered here:
 *
 *   - Whether a particular feature can state a value. That is asked per
 *     feature by `kindsFor`, which probes the feature itself, because a
 *     support with no reaction yet genuinely has nothing to say.
 *   - Whether the annotation should be shown. That is display state, and
 *     lives in `magnitudeShownFor`.
 *
 * This only answers the structural question: is there ever a box for this
 * kind of feature.
 */
function annotatableTypes() {
  const types = new Set();

  Object.keys(KINDS).forEach((kind) => {
    const describes = KINDS[kind]?.describes;

    if (!Array.isArray(describes)) {
      return;
    }

    describes.forEach((type) => types.add(type));
  });

  return types;
}

/*
 * How an annotation's text is chosen.
 *
 * The three are genuinely different, and conflating them is how
 * annotations come to misbehave:
 *
 *   "auto"      the feature's value, re-read every time
 *   "manual"    text the student typed, about anything
 *   "feature-name" the feature's own name, which a rename updates
 */
const TEXT_MODES = {
  auto: "auto",
  manual: "manual",
  "feature-name": "feature-name"
};

/*
 * ========================================================
 * IDENTITY
 * ========================================================
 */

function newAnnotationId() {
  const random =
    typeof globalThis.crypto === "object" &&
    globalThis.crypto &&
    typeof globalThis.crypto.randomUUID === "function"
      ? globalThis.crypto.randomUUID().replace(/-/g, "")
      : Math.random().toString(16).slice(2);

  return `annotation-${random.slice(0, 8)}`;
}

/*
 * ========================================================
 * CREATION
 * ========================================================
 */

/*
 * Build an Annotation.
 *
 *   kind              what it is, from the KINDS table
 *   textMode          auto | manual | feature-name
 *   text              the student's own words, for a manual one
 *   sourceFeatureId   who it is about, or null
 *   anchorRef         which part of that feature, for a profile value
 *   position          where it sits, in drawing units
 *   leader            whether it has a leader, and to what
 *   style             text size, alignment, and so on
 *
 * There is deliberately no `value` parameter for a generated
 * annotation. Its text comes from the feature, and a parameter here
 * would invite a caller to pass a number that then disagreed with
 * the feature it claims to describe.
 */
function createAnnotation({
  kind = "free-text",
  textMode = TEXT_MODES.manual,
  text = "",
  sourceFeatureId = null,
  anchorRef = null,
  position = { x: 0, y: 0 },
  leader = null,
  style = {},
  name,
} = {}) {
  /*
   * A generated annotation is one that reads its text from a
   * feature. Without a feature there is nothing to read from, so it
   * becomes a written note rather than an annotation that silently
   * renders as an empty label forever. That is the safer of the two
   * wrong answers: an empty box on a drawing is a visible defect,
   * while a note is at least readable.
   */
  const generated = isGenerated(kind);

  const mode =
    generated && sourceFeatureId
      ? textMode === TEXT_MODES["feature-name"]
        ? TEXT_MODES["feature-name"]
        : TEXT_MODES.auto
      : TEXT_MODES.manual;

  return {
    id: newAnnotationId(),
    name:
      name || KINDS[kind]?.label || "Annotation",
    type: "annotation",

    annotationKind: kind,

    textMode: mode,

    /*
     * The student's own words. Kept even for a generated
     * annotation - it is what the annotation showed before it was
     * associated, and what it falls back to if the feature is
     * removed while the note is worth keeping.
     */
    text: String(text || ""),

    /*
     * WHO the annotation is about.
     *
     * Separate from everything below, and never written by anything
     * that moves the annotation. This is the field that must
     * survive the student dragging the text box across the sheet.
     */
    sourceFeatureId,

    /*
     * WHICH PART of that feature, for an annotation about one
     * profile point of a varying load rather than the load as a
     * whole.
     */
    anchorRef,

    /*
     * WHERE the annotation sits, in drawing units.
     *
     * The student's to choose, and independent of the feature. See
     * the note at the top of this file: this field changing must
     * never touch sourceFeatureId.
     */
    placement: {
      x: Number(position?.x) || 0,
      y: Number(position?.y) || 0
    },

    /*
     * Whether the student has taken charge of the position.
     *
     * Set when they move the annotation, and it is what stops
     * automatic placement reclaiming it. An automatically placed
     * annotation can be repositioned when its source moves; a
     * manually placed one never is, unless the student asks.
     */
    placementMode: "auto",

    /*
     * The leader, when the annotation has one.
     *
     * It belongs to the annotation and is stored as its geometry -
     * not as a Line feature. A leader that were a separate feature
     * would be selectable, listable, deletable and savable on its
     * own, and would survive its annotation being deleted, which is
     * a line left pointing at nothing.
     */
    leader: {
      enabled: Boolean(leader?.enabled),
      target: leader?.target || "source",
      elbow: leader?.elbow || null
    },

    style: {
      fontSize: 12,
      align: "left",
      ...style
    },

    /*
     * Whether the annotation is drawn. A real state rather than a
     * deletion, so hiding a label and losing it are different
     * things and the first can be undone.
     */
    visible: true
  };
}

/*
 * ========================================================
 * TEXT
 * ========================================================
 */

/*
 * What an annotation currently says.
 *
 * A generated annotation reads its feature and formats the value it
 * finds. A written one says what the student typed. The two paths
 * are separate functions rather than one function with a branch, so
 * there is no way for a generated annotation to fall through to its
 * stored text and quietly go stale - which is the exact failure
 * associative annotations exist to prevent.
 *
 * Returns null when an annotation is about something that is no
 * longer there, so a caller can mark it unresolved instead of
 * displaying text that no longer corresponds to anything.
 */
/*
 * ========================================================
 * THE UNIT IS PART OF THE QUANTITY, NOT A SETTING
 * ========================================================
 *
 * A magnitude annotation is ALWAYS written with its unit, and there
 * is no control anywhere that turns one off:
 *
 *     100 N          5 N/m          25 N·m
 *
 * A unit is not decoration on a number - it is what says whether 250
 * is millimetres, newtons or kilonewtons, and a drawing that routinely
 * carries a 250 mm dimension beside a 250 N force needs the reader to
 * be able to tell them apart. So the unit is assembled HERE and always
 * printed, rather than being printed at each call site where it could
 * be left out.
 *
 * THE UNIT USED TO BE A SETTING. There was a `Show Units` flag, and
 * with it off every value drew as a bare number - which is a different
 * STATEMENT, not a plainer rendering of the same one. It is gone, and
 * the remaining `showUnits` on a document is accepted only so a file
 * saved before the control was removed still reads back; it no longer
 * decides anything, and no path may branch on it.
 *
 * THE NUMBER IS NEVER ROUNDED DIFFERENTLY. The unit is text beside a
 * figure, not part of it.
 */
function unitSuffix(unit) {
  /*
   * ALWAYS WRITTEN, WITH NO FLAG BEHIND IT.
   *
   * There is deliberately no second parameter. A `showUnits` boolean
   * used to be threaded through every text builder and thrown away a
   * few lines later, which left the unit system reading as though it
   * were still optional - and left every caller passing a value that
   * could only ever have one answer. A magnitude without its unit is a
   * number that could be any quantity of that size, and a statics
   * drawing routinely carries a 100 N force beside a 100 mm span,
   * which is exactly the pair a reader must be able to tell apart.
   */
  return ` ${unit}`;
}

/*
 * The parts of a generated value, so a caller can decide what to do with
 * the unit without having to strip it back out of a string.
 */
function quantity(
  label,
  value,
  unit
) {
  return `${label} = ${formatNumber(value)}${unitSuffix(unit)}`;
}

/*
 * ========================================================
 * THE DISPLAY SETTINGS A LABEL IS DRAWN WITH
 * ========================================================
 *
 * Read from the document state, and DEFAULTED HERE rather than assumed.
 *
 * These are workspace settings - Show Magnitudes and Show Dimensions -
 * and they live on the state rather than on any feature, because they
 * are a property of the sheet being read rather than of anything drawn
 * on it. That is why a label has to be told them rather than find them
 * on its own source.
 *
 * UNITS ARE NOT ONE OF THEM. There is no unit setting, globally or per
 * feature: a visible quantity always carries its unit, because the
 * unit is what the number means rather than how it is dressed. A
 * document saved with a `showUnits` field still loads; the field is
 * simply not read, so it cannot strip a unit off anything.
 *
 * EVERY SETTING DEFAULTS TO ON.
 *
 * The absence of a setting must not silently mean "off": a drawing saved
 * before these existed, or one loaded by a test with a bare state, would
 * come back with every magnitude stripped off it. The conservative
 * reading of "nobody said otherwise" is the one that was always in
 * force, so that is what an absent field means.
 *
 * Only an explicit `false` turns one off.
 */
function displaySettingsOf(state) {
  const display = (state && state.display) || {};

  return {
    showMagnitudes: display.showMagnitudes !== false,
    showDimensions: display.showDimensions !== false
  };
}

/*
 * ========================================================
 * DOES THIS ONE FEATURE'S ANNOTATION APPEAR?
 * ========================================================
 *
 * There are two switches, and they are not the same question:
 *
 *   THE GLOBAL ONE says whether magnitude annotations are wanted on this
 *   sheet at all. It is a bulk control: turning it off means "no magnitudes
 *   anywhere", and no single feature may argue with that.
 *
 *   THE PER-FEATURE ONE says whether THIS feature's annotation is wanted,
 *   on a sheet where magnitudes are wanted. It exists because twenty forces
 *   on one diagram is unreadable, and the student is the only one who knows
 *   which three matter.
 *
 * The per-feature switch therefore only ever NARROWS the global one. Turning
 * Magnitudes off globally hides everything, including a feature that asked
 * to be shown; turning it back on restores each feature to what it had
 * asked for, rather than flattening them all to "on".
 *
 * That last part is why the preference is stored on the FEATURE and not
 * recomputed from the global switch: if it were derived, toggling the
 * global control off and on again would silently forget every individual
 * choice the student had made in between.
 *
 * An absent preference means "no opinion", which is not the same as "off":
 * it defers to the global setting, so a feature the student has never
 * touched follows the sheet.
 */
function magnitudeShownFor(object, state) {
  const settings = displaySettingsOf(state);

  if (!settings.showMagnitudes) {
    return false;
  }

  const preference = featurePreference(object);

  if (preference === null || preference === undefined) {
    return true;
  }

  return preference !== false;
}

/*
 * THE FEATURE'S OWN OPINION, read from where the panel writes it.
 *
 * `annotationDisplay` holds the per-feature overrides. It is read defensively
 * because an older document will not have it at all, and an absent holder
 * must mean "no opinion" rather than throwing while repainting a panel.
 */
function featurePreference(object) {
  if (!object || typeof object !== "object") {
    return null;
  }

  const holder =
      object.annotationDisplay ||
      object.display ||
      null;

  if (
      !holder ||
      typeof holder !== "object"
  ) {
      return null;
  }

  const value = holder.showMagnitude;

  if (value === undefined || value === null) {
    return null;
  }

  /*
   * Only an explicit boolean is an opinion. A string "false" here would be
   * truthy and would mean the opposite of what it says, which is how a
   * toggle ends up permanently on and inexplicable.
   */
  if (typeof value === "boolean") {
    return value;
  }

  return value === "true";
}

function textFor(
  annotation,
  state
) {
  if (annotation.textMode === TEXT_MODES.manual) {
    return annotation.text;
  }

  /*
   * THE FEATURE, from the state where it is in the document.
   *
   * A previewed feature is NOT in the document - it is the load the
   * student is still building - so it is offered as an override on the
   * annotation itself by `derivedAnnotations`. That is what lets the
   * magnitude preview be drawn beside the load the student is about to
   * commit, rather than only appearing once it exists.
   */
  const object =
    annotation.sourceObject ||
    findObject(
      state,
      annotation.sourceFeatureId
    );

  /*
   * A generated annotation whose feature has gone.
   *
   * The student's own words are kept where there are any, because a
   * note someone wrote by hand is worth more than a derived value
   * that has stopped existing. Where there are none, the annotation
   * reports that it can no longer be resolved - which shows as an
   * obvious problem rather than as a silently wrong label.
   */
  if (!object) {
    return annotation.text ? annotation.text : null;
  }

  if (
    annotation.textMode ===
    TEXT_MODES["feature-name"]
  ) {
    return object.name || null;
  }

  return generatedText(
    annotation,
    object
  );
}

/*
 * ========================================================
 * SHOULD THIS ANNOTATION BE DRAWN AT ALL?
 * ========================================================
 *
 * A second question from the first one, and the distinction is the whole
 * point of having Show Magnitudes as its own control.
 *
 * `textFor` answers "what does it say". This answers "is there
 * something to say". A force with Show Magnitudes OFF should have NO
 * annotation on it - not an annotation with its text emptied, which
 * would leave a leader line running to nowhere with a stub where the
 * value was.
 *
 * ONLY GENERATED ANNOTATIONS ARE SUBJECT TO IT. A note the student
 * WROTE is theirs: it is not a magnitude, it is their own words about
 * the drawing, and a setting about printed engineering values has no
 * business removing it. The same goes for a feature's name shown as a
 * label.
 */
function isVisible(annotation, state) {
  if (annotation.textMode === TEXT_MODES.manual) {
    return true;
  }

  if (
    annotation.textMode ===
    TEXT_MODES["feature-name"]
  ) {
    return true;
  }

  if (
    !displaySettingsOf(state).showMagnitudes
  ) {
    return false;
  }

  return Boolean(
    textFor(annotation, state)
  );
}

/*
 * WHICH LABELS CAN BE WRITTEN ABOUT THIS FEATURE.
 *
 * Answered by trying, not by type.

 * A kind is available for a feature when asking that kind to state

 * something about it produces real text. That is the honest test, and it is

 * the only one that stays correct as features are added: there is no list

 * of which kinds suit which types, so nothing here can fall out of step

 * with a new feature the way a lookup table would.

 * A feature with no magnitude, for instance, produces nothing for

 * "force-value", so that kind is simply not offered - rather than being

 * offered and then drawing an empty box on the student's drawing.

 * Probing is cheap (a handful of kinds, no drawing) and it is the same

 * code path the annotation will use once created, so what is offered is

 * exactly what will appear.

 * Order matters: the first is the default, so the kinds that say the most

 * come first and the plain label is the fallback.

 */
/*
 * ========================================================
 * WHICH KIND A FEATURE'S MAGNITUDE IS WRITTEN AS
 * ========================================================
 *
 * One answer per feature type, declared rather than discovered by
 * probing. A force's magnitude is `force-value`; a moment's is
 * `moment-value`; a load's is `load-value`. Naming the kind here is what
 * lets the box stay the SAME box as the value changes - the id it is
 * keyed by does not move - and what stops it being replaced by a
 * different kind when the value is momentarily silent.
 *
 * Returning null means the feature has no magnitude box of its own. An
 * annotation kind the student chose by hand (force-components, a support
 * label) is not this: those are asked for explicitly and are not derived
 * from a value that can be cleared.
 */
const NATURAL_MAGNITUDE_KIND = {
  force: "force-value",
  resultant: "resultant-value",
  moment: "moment-value",
  load: "load-value",
  "force-components": "force-components"
};

function naturalMagnitudeKind(object) {
  return NATURAL_MAGNITUDE_KIND[object?.type] || null;
}

/*
 * ========================================================
 * A VALUE THAT FOLLOWS ITS FEATURE
 * ========================================================
 *
 * Show Magnitudes was only ever able to reveal annotations that ALREADY
 * existed, and the only thing that made one was the manual Annotation
 * tool. So a student who enabled it on a sheet of forces saw no change:
 * there was nothing underneath to reveal. The value was always
 * computable - `textFor` could state it - but nothing asked it to.
 *
 * So the value is derived HERE, at draw time, from the feature itself.
 *
 * IT IS NOT STORED IN THE DOCUMENT, and that is the point. A stored one
 * would be a second copy of a number the force already owns, free to go
 * stale the moment the magnitude is edited, and it would push back when
 * the force moves. Derived every frame, it cannot disagree with its
 * source: there is nothing to fall out of step.
 *
 * Returning null means "this feature has no magnitude to show", which
 * is a normal answer for a beam or a circle, not a failure.
 */
function derivedAnnotation(object, state) {
  /*
   * THE FIRST, for a caller that only wants one. A feature with several
   * magnitude annotations returns its first here; use
   * `derivedAnnotations` where every one is wanted - which is every
   * caller that draws, picks or measures.
   */
  return derivedAnnotations(object, state)[0] || null;
}

/*
 * ========================================================
 * EVERY MAGNITUDE ANNOTATION A FEATURE OWNS
 * ========================================================
 *
 * A force, a moment and a uniform load have ONE magnitude, so they have
 * ONE annotation. A VARYING DISTRIBUTED LOAD has one magnitude PER
 * DEFINING POINT, so it has one annotation per defining point - and
 * that count is read from the point list rather than assumed to be two.
 *
 * The relationship is the one the point carries:
 *
 *     VaryingDistributedLoad
 *     |-- Point 1 -> annotation 1
 *     |-- Point 2 -> annotation 2
 *     |-- Point 3 -> annotation 3
 *     `-- ...
 *
 * WHICH POINT IS WHICH IS THE POINT'S OWN ID, not its index in an
 * array. An array shifts when a point is inserted, removed or
 * reordered, and an annotation that followed the index would then
 * silently describe a different point - swapping two labels for no
 * reason the student could see. The id does not move.
 *
 * The list is derived fresh every frame, so it cannot disagree with the
 * point list: adding a point adds its annotation, and removing a point
 * removes the annotation with it, with nothing left pointing at a
 * point that is gone.
 */
function derivedAnnotations(object, state) {
  if (!object) {
    return [];
  }

  /*
   * Whether magnitudes are wanted at all, and whether this feature has an
   * opinion. The second defers to the first, and only ever narrows it.
   */
  if (!magnitudeShownFor(object, state)) {
    return [];
  }

  /*
   * The student's own annotations for this feature already say what
   * they want said. A derived value beside them would print the
   * magnitude twice, and neither copy would be the one they placed.
   */
  const existing = annotationsFor(state, object.id);

  if (existing.some((a) => isGenerated(a.annotationKind))) {
    return [];
  }

  /*
   * A VARYING LOAD'S MAGNITUDE IS ONE PER DEFINING POINT, so its
   * annotation set is built from the points themselves - never assumed
   * to be two. Two points give two labels, three give three, and N give
   * N, because the count IS the number of defined points.
   *
   * WHICH LOAD IS A VARYING ONE. A uniform Distributed Load and a
   * two-point Varying Load are both a `load` object with a point list,
   * and they genuinely must be told apart: the uniform load states one
   * average intensity, while the varying load must state one value per
   * point even when it happens to have just two. The tool that created
   * the load is what decides, recorded on the feature when it was made;
   * a profile carrying more than the two points a uniform load ever has
   * is varying as well, so an older file or a hand-built one still
   * reads correctly.
   */
  if (object.type === "load" || object.type === "varying-load") {
    const points = profilePointsOf(object);

    if (isVaryingLoad(object) || points.length > 2) {
      return points
        .map((point) =>
          derivedProfileAnnotation(object, point, state)
        )
        .filter(Boolean);
    }
  }

  /*
   * THE KIND THIS FEATURE'S MAGNITUDE BOX IS WRITTEN AS.
   *
   * A force's magnitude reads as `force-value`; it does not fall through
   * to `force-components` ("Fx = ... / Fy = ...") just because the plain
   * value is momentarily silent. Components are a DIFFERENT statement
   * about the force, and one the student asks for explicitly through the
   * annotation tool - not a substitute that appears when the value has
   * none.
   *
   * That is the bug this avoids: with the value marked Unknown and no
   * label, `force-value` has nothing to say, and taking "the first kind
   * that produces text" would silently swap the label for the components.
   * The question is not "which kind can speak" but "is THIS feature's
   * magnitude to be written" - and when it is not, the answer is no box.
   */
  const kind = naturalMagnitudeKind(object);

  if (!kind || !kindsFor(object, state).includes(kind)) {
    return [];
  }

  const annotation = {
    id: `derived-${object.id}-${kind}`,
    type: "annotation",
    sourceFeatureId: object.id,
    annotationKind: kind,
    textMode: TEXT_MODES.generated,

    /*
     * The feature itself, so a PREVIEWED feature - one not yet in the
     * document - can still be read for its value. A committed feature is
     * found through the state as usual; this is the same object either
     * way, so there is no second description of the source.
     */
    sourceObject: object,
  };

  /*
   * Placement is asked for AFTERWARDS, because suggestPlacement reads
   * the kind off the annotation it is handed - so it has to be handed a
   * whole one. Building the placement inside the literal would refer to
   * `annotation` before it exists.
   */
  annotation.placement = suggestPlacement(annotation, state);

  /*
   * ========================================================
   * AND THEN THE STUDENT'S OWN MOVE IS APPLIED
   * ========================================================
   *
   * The suggestion above is where the box NATURALLY falls - beyond the
   * arrowhead, on the side the reader looks along. It is a starting
   * position, not a fixed one: `F = 100 N` printed across an arrowhead is
   * unreadable, and the student is the only one who knows where on a busy
   * sheet there is room for it.
   *
   * So a moved box stores WHERE IT WAS PUT and this adds that to the
   * suggestion. Only the position is remembered - the text is still
   * derived from the feature on every frame, so moving the box cannot
   * make its number disagree with the force it belongs to, and editing the
   * force cannot make the box drift off the number.
   *
   * An offset of zero or none means "where it naturally falls", which is
   * where a box that has never been moved sits, and where it returns if
   * the student drags it back to where it started.
   */
  const offset = object.geometry?.magnitudeOffset;

  if (offset && (offset.x || offset.y)) {
    annotation.placement = {
      x: annotation.placement.x + (offset.x || 0),
      y: annotation.placement.y + (offset.y || 0),
    };

    /*
     * MARKED AS MOVED, so the renderer and the hit test agree about which
     * box is being drawn and do not each work it out separately.
     */
    annotation.moved = true;
  }

  /*
   * Asked of the real object rather than assumed, so a kind that offers
   * but cannot state (no magnitude field on this particular feature)
   * contributes nothing instead of a leader to an empty spot.
   */
  if (!textFor(annotation, state)) {
    return [];
  }

  return [annotation];
}

/*
 * The defining points of a load, as the shared profile module reads them,
 * or an empty list when it is not loaded.
 */
function profilePointsOf(object) {
  const shared =
    typeof enggLoadProfile !== "undefined" &&
    typeof enggLoadProfile.profilePoints === "function"
      ? enggLoadProfile.profilePoints(object.geometry)
      : [];

  const points = shared.length
    ? shared
    : Array.isArray(object.geometry?.points)
      ? object.geometry.points
      : [];

  /*
   * EVERY POINT GETS AN IDENTITY, even one read from a list that
   * carries none. Two labels must be two things, and a point with no id
   * would give every label on the load the same computed name - so the
   * identity is filled in here, positionally and deterministically, and
   * only for as long as the point list says nothing better.
   */
  return points.map((point, index) => ({
    ...point,
    id:
      typeof point.id === "string" && point.id.length
        ? point.id
        : `lp-index-${index}`
  }));
}

/*
 * Is this load a VARYING one, whose magnitude is stated per point?
 *
 * Read from how it was made - the statics tool recorded on the feature
 * when it was created - so a two-point varying load is not mistaken for
 * a uniform one. The tool check is the primary answer; a profile with
 * more points than a uniform load can have is varying regardless, which
 * keeps a file saved before the tool was recorded reading correctly.
 */
const VARYING_LOAD_TOOL = "varying-distributed-load";

function isVaryingLoad(object) {
  if (!object || object.type === "varying-load") {
    return Boolean(object);
  }

  return (
    object.engineering?.staticsType === VARYING_LOAD_TOOL
  );
}

/*
 * ONE MAGNITUDE ANNOTATION, FOR ONE DEFINING POINT.
 *
 * It states that point's magnitude and nothing else: no angle, because
 * the arrows already carry the direction, and no other point's value,
 * because each point owns its own number.
 *
 * Its POSITION is independent of the load and stays where the student
 * puts it. The default falls beside the point it describes; a stored
 * offset for THAT POINT, keyed by the point's id, takes over the moment
 * the student moves it, and is never recomputed afterwards.
 */
function derivedProfileAnnotation(object, point, state) {
  const annotation = {
    id: `derived-${object.id}-profile-${point.id}`,
    type: "annotation",
    sourceFeatureId: object.id,
    annotationKind: "load-profile-value",
    textMode: TEXT_MODES.generated,

    /*
     * The feature itself, so a previewed load - still being defined and
     * not yet in the document - can be read for its point's magnitude.
     */
    sourceObject: object,

    /*
     * WHICH PART of the feature this is about. The declaration is
     * unchanged; `anchorFor` in the loader reads the geometry, so
     * the annotation model simply carries it.
     */
    anchorRef: { pointId: point.id },
  };

  annotation.placement = suggestProfilePlacement(
    annotation,
    object,
    point
  );

  /*
   * A MOVED LABEL KEEPS ITS ABSOLUTE PLACE.
   *
   * The stored value is WHERE THE STUDENT PUT IT, not a distance from a
   * default - because the default is not a fixed point. It is read from
   * the load's direction, so reversing the load would move a label that
   * was only ever remembered as "some way off the default". Storing the
   * place itself makes the student's choice authoritative: nothing about
   * the source - its direction, its magnitudes, the visual scale of its
   * arrows - can move it again.
   */
  const placed = profilePointPlacement(object, point.id);

  if (placed) {
    annotation.placement = {
      x: placed.x,
      y: placed.y,
    };

    annotation.moved = true;
  }

  if (!textFor(annotation, state)) {
    return null;
  }

  return annotation;
}

/*
 * The student's stored PLACE for ONE defining point, keyed by id.
 *
 * This is an absolute drawing-space position, not an offset from a
 * default: the default follows the load's direction, so an offset would
 * move a label when the load was reversed. The place is what the
 * student chose and nothing recomputes it.
 */
function profilePointPlacement(object, pointId) {
  const geometry = object.geometry || {};

  const offsets = geometry.pointOffsets;

  const stored =
    offsets &&
    typeof offsets === "object" &&
    offsets[pointId] &&
    typeof offsets[pointId] === "object"
      ? offsets[pointId]
      : null;

  if (!stored) {
    return null;
  }

  const x = Number(stored.x);
  const y = Number(stored.y);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return { x, y };
}

/*
 * ========================================================
 * A SUPPORT'S OWN VALUES
 * ========================================================
 *
 * A support carries a small, fixed set of values, decided by what the
 * support is. A roller resists perpendicular to its surface, so it has one;
 * a pin resists in both directions, so it has two; a fixed support also
 * resists rotation, so it has three. A smooth support reacts along the
 * normal, so it has one, named for the normal force rather than an axis.
 *
 * THE TABLE IS THE AUTHORITY, and it is read by BOTH the Features panel
 * and the annotation model - so the panel cannot offer a field the sheet
 * will not draw, and the sheet cannot draw a value the panel has no field
 * for. That single answer is what keeps the two in step.
 *
 * NOTHING HERE SOLVES ANYTHING. A value is a number the STUDENT typed,
 * exactly as a force's magnitude is: it is stated, not computed. There is
 * no equilibrium, no reaction derivation and no solver - a support value is
 * blank until the student writes one, and blank means it is not yet known,
 * which is a normal state and not a failure.
 *
 * `id` is stable and is what a value's stored position is keyed by, so a
 * value's box keeps the place it was put even as the support moves or the
 * label is edited.
 */
const SUPPORT_REACTION_VALUES = {
  "pin-support": [
    { id: "fx", label: "Ax", axis: "x", unit: "N" },
    { id: "fy", label: "Ay", axis: "y", unit: "N" }
  ],
  "roller-support": [
    { id: "fy", label: "Ay", axis: "y", unit: "N" }
  ],
  "fixed-support": [
    { id: "fx", label: "Ax", axis: "x", unit: "N" },
    { id: "fy", label: "Ay", axis: "y", unit: "N" },
    { id: "ma", label: "M_A", axis: "moment", unit: "N\u00b7m" }
  ],
  "smooth-support": [
    { id: "n", label: "N", axis: "normal", unit: "N" }
  ]
};

/*
 * Is this feature a SUPPORT whose reactions are stated as annotations?
 *
 * Answered from the same table that lists a support's values, so the
 * branch that builds its annotations and the function that names them
 * cannot disagree about which types carry reactions.
 */
function isSupportType(type) {
  return Boolean(SUPPORT_REACTION_VALUES[type]);
}

/*
 * The values a support has, in the order they are shown and drawn.
 *
 * A support with no entry has none: an unrecognised support type states
 * nothing rather than being given a guessed set of axes.
 */
function supportReactionValues(object) {
  if (!object) {
    return [];
  }

  return SUPPORT_REACTION_VALUES[object.type] || [];
}

/*
 * WHERE a support's stored values live, and creating the holder on first
 * use. Kept as one reader so the panel, the annotation model and the drag
 * all write to the same place.
 */
function supportValuesHolder(object, create) {
  if (!object.geometry || typeof object.geometry !== "object") {
    if (!create) {
      return null;
    }

    object.geometry = {};
  }

  const existing = object.geometry.supportValues;

  if (existing && typeof existing === "object") {
    return existing;
  }

  if (!create) {
    return null;
  }

  object.geometry.supportValues = {};

  return object.geometry.supportValues;
}

/*
 * ONE SUPPORT VALUE'S STATE, whether it has been filled in or not.
 *
 * A value that has never been edited has no entry, and this answers with
 * the declared defaults - the conventional label, no magnitude, and the
 * Question Mark OFF. That way an untouched support behaves exactly as a
 * freshly declared one, without anything having to be written to the
 * document just to read it.
 */
function supportValueState(object, value) {
  const holder = supportValuesHolder(object, false);

  const stored =
    holder && holder[value.id] && typeof holder[value.id] === "object"
      ? holder[value.id]
      : null;

  const rawLabel =
    stored && stored.label !== undefined
      ? stored.label
      : value.label;

  const rawMagnitude = stored ? stored.magnitude : null;

  const magnitude =
    rawMagnitude === null || rawMagnitude === undefined || rawMagnitude === ""
      ? null
      : Number(rawMagnitude);

  return {
    id: value.id,
    unit: value.unit,
    axis: value.axis,

    /*
     * THE LABEL IS THE STUDENT'S. An empty string is a real choice - "do
     * not write a name on this one" - and is kept distinct from "never
     * touched", which falls back to the conventional label. That is why
     * the default is only applied when the field is absent.
     */
    label: stored && typeof rawLabel === "string" ? rawLabel : value.label,

    magnitude:
      magnitude !== null && Number.isFinite(magnitude) ? magnitude : null,

    /*
     * THE QUESTION MARK, read as a real boolean state. Absent means OFF,
     * and only an explicit true turns it on.
     */
    questionMark: stored ? stored.questionMark === true : false
  };
}

/*
 * ========================================================
 * WHAT A LABELLED QUANTITY READS AS ON THE SHEET
 * ========================================================
 *
 * THE ONE RULE. Every magnitude-bearing feature - a force, a load, a
 * moment, a support reaction, a varying load's point - states itself by
 * this function and no other:
 *
 *   Question Mark ON   ->  the LABEL alone, never the number and never a
 *                          literal "?"
 *   Label + value      ->  "Label = value unit"
 *   value, no label    ->  "value unit"
 *   Label, no value    ->  the label alone, with no dangling "="
 *   neither            ->  nothing at all
 *
 * A LITERAL "?" IS NEVER DRAWN. The Question Mark is a state of the value,
 * shown in the Features panel, and it means "this one is not known yet" -
 * which on the sheet reads as the name of the unknown quantity and nothing
 * more. Printing a bare "?" on a drawing would state no quantity at all.
 *
 * THE QUESTION MARK ALSO RETIRES THE VALUE. While it is on there is no
 * authoritative number: the rule below reads `magnitude` as absent, so the
 * renderer, the analysis system and the annotation cannot fall back to a
 * number the student has declared unknown. The panel clears the field for
 * the same reason - a value that is not known must not sit in it looking
 * like an answer.
 *
 * It takes (label, magnitude, unit, questionMark) rather than a packed
 * state object, because that is the whole of what the rule needs and it is
 * the same four facts every caller has.
 */
function labelledQuantityText(
  label,
  magnitude,
  unit,
  questionMark
) {
  const name = String(label || "").trim();

  if (questionMark) {
    return name || null;
  }

  const known =
    magnitude !== null &&
    magnitude !== undefined &&
    magnitude !== "" &&
    Number.isFinite(Number(magnitude));

  const quantityText = known
    ? `${formatNumber(Number(magnitude))}${unitSuffix(unit || "")}`
    : "";

  /*
   * VALUE WITHOUT A LABEL still reads as the value: a bare "100 N" is a
   * complete statement about a quantity, and it must not be printed as
   * "= 100 N".
   */
  if (!name) {
    return quantityText || null;
  }

  /*
   * LABEL WITHOUT A VALUE reads as the label: the name of the quantity is
   * still worth printing, and an "=" with nothing after it would be the
   * orphan punctuation the shared panel rules exist to prevent.
   */
  if (!known) {
    return name;
  }

  return `${name} = ${quantityText}`;
}

/*
 * What a SUPPORT value reads as, through the shared rule.
 *
 * A support keeps its own stored state - see supportValueState - and this
 * hands that state to the one rule, so a support's box and a force's box
 * cannot be formatted differently.
 */
function supportValueText(state, value, providedUnit) {
  return labelledQuantityText(
    state.label,
    state.magnitude,
    providedUnit || state.unit || "",
    state.questionMark
  );
}

/*
 * ========================================================
 * WHAT A FEATURE'S OWN VALUE READS AS
 * ========================================================
 *
 * A force, a load and a moment carry their magnitude as a plain geometry
 * field, and their Label and Question Mark in `unknownValues` and
 * `magnitudeLabel` - the very fields the Features panel edits. This is the
 * single reader for that state, so the panel and the sheet cannot disagree
 * about what the student has entered.
 *
 *   magnitudeKey  the geometry field holding the number
 *   defaultLabel  the conventional symbol, used when the student has not
 *                 typed one of their own
 *   unit          the engineering unit the quantity is stated in
 *
 * THE STUDENT'S LABEL WINS. An explicit empty string means "write no name",
 * which is a real choice and is kept distinct from "never touched" - only
 * an absent field falls back to the conventional symbol.
 *
 * UNKNOWN IS THE PANEL'S OWN FLAG, read from `unknownValues` - where the
 * `?` control writes it. When it is on the magnitude is reported as null,
 * so nothing downstream can keep using a number the student has retired.
 */
function featureValueText(object, magnitudeKey, defaultLabel, unit) {
  const geometry = object?.geometry || {};

  const unknown = object?.unknownValues?.[magnitudeKey] === true;

  const raw = geometry[magnitudeKey];

  const missing = raw === null || raw === undefined || raw === "";

  const magnitude = missing ? null : Number(raw);

  const label =
    typeof object?.magnitudeLabel === "string"
      ? object.magnitudeLabel
      : defaultLabel;

  return labelledQuantityText(
    label,
    unknown || magnitude === null || !Number.isFinite(magnitude)
      ? null
      : magnitude,
    unit,
    unknown
  );
}

/*
 * ONE SUPPORT VALUE, AS AN ANNOTATION.
 *
 * Its text is DERIVED every frame from the support's own stored value, so
 * editing the number moves the number and not the box - the same division
 * the force magnitudes use. Its POSITION is stored per value, keyed by the
 * value's id, so moving the vertical value never moves the horizontal one.
 */
export function derivedSupportAnnotation(object, value, state) {
  const values = supportValueState(object, value);

  const annotation = {
    id: `derived-${object.id}-support-${value.id}`,
    type: "annotation",
    sourceFeatureId: object.id,
    annotationKind: "support-value",
    textMode: TEXT_MODES.generated,
    sourceObject: object,

    /*
     * WHICH VALUE of the support this is about. Carried whole so the text
     * reader and the drag both know exactly which value is meant - a fixed
     * support has three, and only the id tells them apart.
     */
    anchorRef: { supportValueId: value.id },

    /*
     * The state itself, so the text reader does not have to re-resolve the
     * feature. It is a plain snapshot; the text is rebuilt from it below.
     */
    supportValue: values
  };

  annotation.placement = suggestSupportValuePlacement(
    annotation,
    object,
    value,
    state
  );

  const offset = supportValueOffset(object, value.id);

  if (offset && (offset.x || offset.y)) {
    annotation.placement = {
      x: annotation.placement.x + (offset.x || 0),
      y: annotation.placement.y + (offset.y || 0)
    };

    annotation.moved = true;
  }

  if (!supportValueText(values, values, values.unit)) {
    return null;
  }

  return annotation;
}

/*
 * The student's stored offset for ONE support value, keyed by id.
 */
function supportValueOffset(object, valueId) {
  const geometry = object.geometry || {};

  const offsets = geometry.supportValueOffsets;

  if (
    offsets &&
    typeof offsets === "object" &&
    offsets[valueId] &&
    typeof offsets[valueId] === "object"
  ) {
    return offsets[valueId];
  }

  return null;
}

/*
 * Where a support value's box falls when the student has not moved it.
 *
 * BESIDE THE SUPPORT, STACKED BY VALUE, so a pin's two values do not land on
 * top of one another. The stack is ordered by the value's place in the
 * declared list, so the vertical value sits above the horizontal one, which
 * is how a free-body diagram is conventionally annotated.
 *
 * IT FALLS ON THE SIDE THE SUPPORT FACES, away from the body it is attached
 * to, so a label never covers the member. The side is read from the same
 * `flipped` flag the symbol is drawn with, so the two always agree.
 */
function suggestSupportValuePlacement(annotation, object, value, state) {
  const anchor =
    object.geometry?.position ||
    object.geometry?.attachment?.point ||
    object.geometry?.start ||
    { x: 0, y: 0 };

  const values = supportReactionValues(object);

  const index = Math.max(
    0,
    values.findIndex((candidate) => candidate.id === value.id)
  );

  /*
   * The direction the symbol faces. A support is drawn pointing away from
   * the member, and `flipped` is which side that is - already the stored
   * fact the renderer draws from, so it is read rather than guessed.
   */
  const facing = object.geometry?.flipped ? 1 : -1;

  const standoff = 18;
  const stackGap = 12;

  return {
    x: anchor.x + standoff,
    y: anchor.y + facing * standoff + index * stackGap * facing * -1
  };
}

/*
 * Where a point's annotation falls when the student has not moved it.
 *
 * Beside the point it describes, on the side the load pushes towards -
 * the same side the arrows are drawn on, so a reader's eye connects the
 * number to the arrow it belongs to.
 *
 * THE POINT, NOT THE GRAPHIC. This is worked out from the point's own
 * world position and the load's direction, never from where an arrowhead
 * happens to have been drawn - so changing the drawn height of the arrows
 * cannot shift where a fresh label appears.
 */
function suggestProfilePlacement(annotation, object, point) {
  /*
   * THE POINT'S OWN WORLD POSITION, from its station along the body.
   *
   * `profilePoints` returns each point as a fraction `t` plus its
   * magnitude; the world point is read from the body with the shared
   * rule the renderer and the handles use, so a fresh label starts
   * beside the very point it describes.
   */
  const position =
    point.position ||
    (
      typeof enggLoadProfile !== "undefined" &&
      typeof enggLoadProfile.pointAlong === "function"
        ? enggLoadProfile.pointAlong(object.geometry, point.t)
        : null
    ) ||
    object.geometry?.start ||
    { x: 0, y: 0 };

  let direction = { x: 0, y: -1 };

  if (
    typeof enggLoadProfile !== "undefined" &&
    typeof enggLoadProfile.unitVector === "function"
  ) {
    direction = enggLoadProfile.unitVector(
      enggLoadProfile.loadDirection(object.geometry)
    );
  }

  const standoff = 10;

  return {
    x: position.x + direction.x * standoff,
    y: position.y + direction.y * standoff,
  };
}

/*
 * ========================================================
 * AND THEN THE STUDENT'S OWN MOVE IS APPLIED
 * ========================================================
 */
function kindsFor(object, state) {
  if (!object) {
    return [];
  }

  return Object.keys(KINDS).filter((kind) => {
    if (!isGenerated(kind)) {
      return false;
    }

    /*
     * A kind must be one this kind of feature can carry.
     *
     * Checked before probing, because the probe cannot tell a moment
     * from a force: both hold a magnitude, so both would answer "F = 500 N"
     * if asked. The declaration is what knows the difference.
     */
    const describes = KINDS[kind].describes;

    if (
      Array.isArray(describes) &&
      !describes.includes(object.type)
    ) {
      return false;
    }

    const probe = {
      annotationKind: kind,
      textMode: TEXT_MODES["auto"],
      text: null,
      sourceFeatureId: object.id
    };

    const text = textFor(probe, state);

    return (
      typeof text === "string" &&
      text.trim().length > 0
    );
  });
}

function findObject(state, objectId) {
  return (
    (state?.objects || []).find(
      (object) => object.id === objectId
    ) || null
  );
}

/*
 * The engineering values a feature actually holds.
 *
 * Reads only what the feature states. Nothing here computes a
 * reaction, an equilibrium or a resultant from other features: if a
 * value is not on the feature, it is not stated, and saying so is
 * better than inventing one. That is the line between annotating a
 * drawing and solving it, and the system stays on the right side of
 * it deliberately.
 */
function generatedText(
  annotation,
  object
) {
  const geometry = object.geometry || {};

  switch (annotation.annotationKind) {
    case "force-value":
      return forceText(object);

    case "force-components":
      return forceComponentText(geometry);

    case "moment-value":
      return momentText(object);

    case "load-value":
      return loadText(object);

    case "load-profile-value":
      return profileText(
        annotation,
        geometry
      );

    case "support-label":
      return supportText(object);

    case "support-value":
      return supportValueAnnotationText(annotation, object);

    case "connection-label":
      return connectionText(object);

    case "resultant-value":
      return resultantText(object);

    case "label":
      return object.name || null;

    default:
      return annotation.text || null;
  }
}

/*
 * A force's magnitude and direction.
 *
 * The magnitude is stated, not computed: it is the number the
 * student typed onto the force. The direction is the force's own
 * angle field, and the components are that magnitude resolved along
 * the axes - which is a restatement of one stored value, not a
 * calculation about the drawing. No reaction is involved, because no
 * reaction exists on the force.
 */
function forceText(object) {
  /*
   * THE UNIT COMES FROM THE FORCE, not from a literal here - the same rule a
   * load's magnitude follows. A force carries the unit it was entered in (N
   * or kN), so the number on the drawing is written the way the student stated
   * it, and the drawing and the Features panel cannot disagree.
   */
  return featureValueText(
    object,
    "magnitude",
    "F",
    forceUnitOf(object)
  );
}

/*
 * The unit a force's magnitude is stated in, read from the shared load module
 * so the annotation and the panel ask one question. The literal is only a
 * fallback for the moment before that module is loaded.
 */
function forceUnitOf(object) {
  return (
    typeof enggLoadProfile !== "undefined" &&
    typeof enggLoadProfile.forceUnit === "function"
      ? enggLoadProfile.forceUnit(object?.geometry)
      : "N"
  );
}

/*
 * A force resolved onto the axes.
 *
 * The components are what the drawing already implies about its own
 * arrow: a force of F at angle Î¸ has those components. Stating them
 * is a reading of the force, not a new fact about it.
 */
function forceComponentText(geometry) {
  const magnitude = Number(geometry.magnitude);
  const angle = Number(geometry.angle);

  if (
    !Number.isFinite(magnitude) ||
    !Number.isFinite(angle)
  ) {
    return null;
  }

  const radians = (angle * Math.PI) / 180;

  return [
    quantity(
      "Fx",
      magnitude * Math.cos(radians),
      "N"
    ),
    quantity(
      "Fy",
      magnitude * Math.sin(radians),
      "N"
    )
  ].join("\n");
}

function momentText(object) {
  /*
   * THE SENSE IS NOT WRITTEN DOWN EITHER.
   *
   * A moment's direction is the curved arrow, drawn clockwise or
   * anticlockwise, and the arc is unambiguous. Appending "CW" or
   * "CCW" to the number repeated it as text - and, as with the force
   * angle, in a second place that could be stale the moment the
   * moment was flipped.
   *
   * THE UNIT IS THE MOMENT'S OWN. It is read from the feature, so the label
   * beside the curved arrow and the unit chosen in the Features panel are one
   * value - a moment set to kilonewton-metres says so on the sheet too.
   */
  return featureValueText(
    object,
    "magnitude",
    "M",
    enggLoadProfile.momentUnit(object.geometry)
  );
}

function loadText(object) {
  /*
   * The intensity alone. Which way a distributed load pushes is
   * shown by the row of arrows above the member - that is the
   * standard way a load diagram reads, and adding a direction
   * glyph to the label duplicated what the arrows already say
   * while consuming space beside every annotation on the sheet.
   *
   * THE UNIT COMES FROM THE LOAD, not from a literal here. A load
   * carries the unit its magnitude is stated in - kN/m or N/mm - and the
   * label reads that one value, so the drawing and the Features panel can
   * never show the same load in two different units.
   */
  return featureValueText(
    object,
    "intensity",
    "w",
    loadUnitOf(object)
  );
}

/*
 * The unit a load's magnitude is stated in, read from the shared load
 * module so the annotation and the panel ask the same question.
 *
 * The literal is only a fallback for the moment before that module is
 * loaded; it is the drawing's own long-standing unit, so even then the
 * label reads as it always did.
 */
function loadUnitOf(object) {
  return (
    typeof enggLoadProfile !== "undefined" &&
    typeof enggLoadProfile.loadUnit === "function"
      ? enggLoadProfile.loadUnit(object?.geometry)
      : "kN/m"
  );
}

/*
 * One profile point of a varying load.
 *
 * A varying load's magnitudes are the values the student placed at
 * its own distribution points, so each gets its own annotation
 * reading that point - not the whole profile, and not a fitted
 * value. Change the point's magnitude and the annotation at that
 * point changes with it.
 */
function profileText(
  annotation,
  geometry
) {
  /*
   * THE SHARED POINT LIST, so a point's id is the one the annotation was
   * built against and the label order matches the drawing's.
   *
   * THE RAW LIST IS THE FALLBACK. A varying load may be described with
   * points that carry no station `t` - a hand-authored or older shape -
   * and those are read in the order they are written, which is what the
   * ordering means when there is nothing to sort by.
   */
  const shared =
    typeof enggLoadProfile !== "undefined" &&
    typeof enggLoadProfile.profilePoints === "function"
      ? enggLoadProfile.profilePoints(geometry)
      : [];

  const points = shared.length
    ? shared
    : Array.isArray(geometry.points)
      ? geometry.points
      : [];

  /*
   * Which point this annotation is about.
   *
   * BY ID WHERE THERE IS ONE. The id is what the annotation was built
   * against and it does not move when the array does, so a point
   * inserted, removed or reordered cannot make this label describe a
   * different point. The index is the fallback for an annotation saved
   * before points had identities - it is only ever used to resolve the
   * label's own point, never to decide ownership of a stored position.
   */
  const wantedId = annotation.anchorRef?.pointId;

  let index;

  if (wantedId) {
    const found = points.findIndex(
      (point) => point.id === wantedId
    );

    /*
     * A point that is gone has no annotation: the label is dropped
     * rather than silently re-pointed at a neighbour, which is exactly
     * the stale label the id exists to prevent.
     */
    if (found < 0) {
      return null;
    }

    index = found;
  } else {
    index = Math.max(
      0,
      Math.min(
        points.length - 1,
        Number(annotation.anchorRef?.index) || 0
      )
    );
  }

  const point = points[index];

  if (!point) {
    return null;
  }

  const magnitude = Number(point.magnitude);

  if (!Number.isFinite(magnitude)) {
    return null;
  }

  /*
   * w1, w2, w3 for the first, second and third - the conventional
   * way of naming a distribution, and clearer than three identical
   * "w = " labels on one load.
   */
  const suffix = String.fromCharCode(
    49 + (index % 9)
  );

  return quantity(
    `w${suffix}`,
    magnitude,
    loadUnitOf({ geometry })
  );
}

/*
 * A support's identity.
 *
 * "Pin A" is the support's own name - which is its type plus the
 * name the student gave it. Renaming the support renames the
 * annotation, which is the point: the label follows the feature.
 */
function supportText(object) {
  const label =
    SUPPORT_LABELS[object.type] ||
    humanise(object.type);

  /*
   * A name the student has set is more specific than the type, and
   * showing both is the useful form: "Pin A" identifies which
   * support is meant on a drawing with several.
   */
  return object.name && object.name !== humanise(object.type)
    ? `${label} ${object.name}`
    : label;
}

const SUPPORT_LABELS = {
  "pin-support": "Pin Support",
  "roller-support": "Roller Support",
  "fixed-support": "Fixed Support",
  "smooth-support": "Smooth Support"
};

/*
 * THE TEXT OF ONE SUPPORT VALUE, read from the support itself.
 *
 * Which value is meant comes from the annotation's `anchorRef` - the value
 * id - because a fixed support has three and they share one feature. The
 * declaration is looked up by id so the wording follows the value the
 * annotation was built for even if the list order changes.
 *
 * A value with no declaration has nothing to say and reports null, which
 * makes its annotation disappear rather than print a label for a quantity
 * that no longer exists.
 */
function supportValueAnnotationText(annotation, object) {
  const valueId = annotation.anchorRef?.supportValueId;

  const declared = supportReactionValues(object).find(
    (value) => value.id === valueId
  );

  if (!declared) {
    return null;
  }

  return supportValueText(
    supportValueState(object, declared),
    declared,
    declared.unit
  );
}

function connectionText(object) {
  const label = {
    "pin-connection": "Pin Connection",
    "fixed-connection": "Fixed Connection",
    "slider-connection": "Slider Connection",
    connection: "Connection"
  }[object.type] || humanise(object.type);

  return object.name && object.name !== humanise(object.type)
    ? `${label} ${object.name}`
    : label;
}

function resultantText(object) {
  /*
   * The resultant's MAGNITUDE. Its direction is the drawn arrow,
   * for the same reason the force's is: the vector is the
   * statement of direction, and a number beside it can only ever be
   * a second copy that may disagree with it.
   *
   * Read through the shared rule, so a resultant carries the same Label
   * and Question Mark controls as the force it was derived from.
   */
  return featureValueText(object, "magnitude", "R", "N");
}

function humanise(type) {
  return String(type || "")
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(
      (word) =>
        word.charAt(0).toUpperCase() +
        word.slice(1)
    )
    .join(" ");
}

/*
 * A number for a label.
 *
 * Two decimal places by default and no thousands separator: a force
 * or a magnitude is a measured quantity, and a label that varied its
 * precision with its magnitude would be one the reader has to
 * interpret rather than read. A large value is not written as
 * "1,500.00" on a drawing.
 */
function formatNumber(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "\\u2014";
  }

  const magnitude = Math.abs(number);

  /*
   * Small values keep more places, because at these scales the
   * decimal places ARE the measurement - 0.25 kN/m and 0.00 kN/m
   * are different loadings.
   */
  const places =
    magnitude === 0
      ? 2
      : magnitude < 1
        ? 3
        : magnitude < 10
          ? 2
          : 1;

  return round(number, places).toFixed(places);
}

function round(value, places) {
  const factor = 10 ** places;

  return (
    Math.round(value * factor * (1 + Number.EPSILON)) /
    factor
  );
}

/*
 * ========================================================
 * PLACEMENT
 * ========================================================
 */

/*
 * Move an annotation, and take charge of where it is.
 *
 * This is the operation the whole module exists to get right.
 *
 * It changes `placement` and NOTHING else. The source feature is
 * not looked up, let alone modified; the association is not
 * revalidated; the text is not regenerated. Moving a label does
 * not move the thing it labels, and does not break the relationship
 * that keeps the label in step with it.
 *
 * The consequence is the one the specification asks for: a student
 * who drags "250 N" to the far side of the sheet gets a label there
 * that still says what the force says, and will say the new number
 * when the force's magnitude changes.
 */
function moveAnnotation(
  annotation,
  position
) {
  annotation.placement = {
    x: Number(position?.x) || 0,
    y: Number(position?.y) || 0
  };

  /*
   * The student has now chosen this position, so automatic
   * placement stops managing it. This is the flag that makes a
   * manually positioned annotation stay where it was put when the
   * source feature later moves - which is the behaviour a label
   * needs in order to be usable on a busy drawing.
   */
  annotation.placementMode = "manual";

  return annotation;
}

/*
 * Record where a MOVED magnitude label sits, on the SOURCE FEATURE.
 *
 * The derived label is not a document feature, so there is nowhere on
 * it to keep a position: the offset lives on the feature it describes.
 * That is also correct - the label belongs to the feature, and its
 * offset is meaningless without it.
 *
 * A VARYING LOAD STORES ONE OFFSET PER POINT, keyed by the point's own
 * id. The old single `magnitudeOffset` cannot express that: it would
 * move every label whenever one was dragged, and its meaning would
 * shift with the array whenever a point was inserted or removed. So a
 * point-anchored label writes `geometry.pointOffsets[pointId]`, and a
 * label with no point (a force, a moment, a uniform load) keeps the
 * plain single offset.
 */
function moveDerivedAnnotation(
  source,
  annotation,
  offset
) {
  if (!source || !source.geometry) {
    return;
  }

  const pointId = annotation?.anchorRef?.pointId;

  if (pointId) {
    const offsets =
      source.geometry.pointOffsets &&
      typeof source.geometry.pointOffsets === "object"
        ? source.geometry.pointOffsets
        : {};

    offsets[pointId] = {
      x: Number(offset?.x) || 0,
      y: Number(offset?.y) || 0
    };

    source.geometry.pointOffsets = offsets;

    return;
  }

  /*
   * A SUPPORT VALUE STORES ONE OFFSET PER VALUE, keyed by the value's id -
   * for exactly the reason a varying load stores one per point. A fixed
   * support has three values sharing one feature, and a single offset would
   * drag all three whenever the student moved one.
   */
  const supportValueId = annotation?.anchorRef?.supportValueId;

  if (supportValueId) {
    const offsets =
      source.geometry.supportValueOffsets &&
      typeof source.geometry.supportValueOffsets === "object"
        ? source.geometry.supportValueOffsets
        : {};

    offsets[supportValueId] = {
      x: Number(offset?.x) || 0,
      y: Number(offset?.y) || 0
    };

    source.geometry.supportValueOffsets = offsets;

    return;
  }

  source.geometry.magnitudeOffset = {
    x: Number(offset?.x) || 0,
    y: Number(offset?.y) || 0
  };
}

/*
 * Return one magnitude label to where it naturally falls.
 *
 * Called when a drag is abandoned without moving, so an accidental
 * nudge does not leave a label a pixel out of place forever. It clears
 * exactly the slot the label owns - one point, or the whole feature -
 * and leaves every other label where it was.
 */
function resetDerivedAnnotation(
  source,
  annotation
) {
  if (!source || !source.geometry) {
    return;
  }

  const pointId = annotation?.anchorRef?.pointId;

  if (pointId && source.geometry.pointOffsets) {
    delete source.geometry.pointOffsets[pointId];

    return;
  }

  const supportValueId = annotation?.anchorRef?.supportValueId;

  if (supportValueId && source.geometry.supportValueOffsets) {
    delete source.geometry.supportValueOffsets[supportValueId];

    return;
  }

  source.geometry.magnitudeOffset = null;
}

/*
 * Hand an annotation back to automatic placement.
 *
 * The explicit act the specification reserves for this: once a
 * student has said "I want it here", nothing moves it until they
 * say otherwise.
 */
function releaseToAutomaticPlacement(
  annotation
) {
  annotation.placementMode = "auto";

  return annotation;
}

/*
 * ========================================================
 * WHERE THE TEXT ACTUALLY IS - THE BOX A CLICK MUST HIT
 * ========================================================
 *
 * A magnitude label is text, and text has an extent. Picking it by a
 * single point - the annotaton's anchor, or the source load's bounds -
 * is what makes a label hard to grab: the student aims at the letters
 * and the system tests somewhere else.
 *
 * So the box is measured from WHAT IS DRAWN: the number of characters
 * on the longest line, the font size, and the number of lines, laid
 * out the way the renderer lays them out - centred horizontally on the
 * placement point, centred vertically over it.
 *
 * It is an ESTIMATE of the glyph widths rather than a real measurement,
 * and deliberately so: it has to give the same answer in the renderer
 * (which has a DOM), in the hit test and in a headless test with no
 * font metrics at all. A character-width factor that is slightly
 * generous is the right side to err on - a label that is a little
 * easier to hit than it looks is a convenience, while one that is a
 * little harder is the defect this exists to remove.
 */
const TEXT_CHARACTER_WIDTH = 0.62;
const TEXT_LINE_HEIGHT = 1.2;

function annotationTextBounds(
  annotation,
  state
) {
  const text = textFor(annotation, state);

  if (!text || !annotation.placement) {
    return null;
  }

  const lines = String(text).split("\n");

  const fontSize =
    Number(annotation.style?.fontSize) || 12;

  const longest = lines.reduce(
    (max, line) => Math.max(max, line.length),
    0
  );

  const width = longest * fontSize * TEXT_CHARACTER_WIDTH;
  const height = lines.length * fontSize * TEXT_LINE_HEIGHT;

  const cx = Number(annotation.placement.x) || 0;
  const cy = Number(annotation.placement.y) || 0;

  return {
    cx,
    cy,
    width,
    height,
    minX: cx - width / 2,
    maxX: cx + width / 2,
    minY: cy - height / 2,
    maxY: cy + height / 2
  };
}

/*
 * The box around a PLAIN STRING of drawing text at a position.
 *
 * The same estimation `annotationTextBounds` makes, for text that is not an
 * annotation object - a coordinate system's axis label, which is drawn from the
 * feature's own geometry rather than from an annotation. Measuring it here, with
 * the same character-width factor the renderer lays text out with, is what keeps
 * "what a click can reach" and "what is drawn" the same box.
 */
function drawnTextBounds(text, position, fontSize = 13) {
    const lines = String(text ?? "").split("\n");

    if (!lines.length || !lines[0]) {
        return null;
    }

    const longest = lines.reduce(
        (max, line) => Math.max(max, line.length),
        0
    );

    const width = longest * fontSize * TEXT_CHARACTER_WIDTH;
    const height = lines.length * fontSize * TEXT_LINE_HEIGHT;

    const cx = Number(position?.x) || 0;
    const cy = Number(position?.y) || 0;

    return {
        cx,
        cy,
        width,
        height,
        minX: cx - width / 2,
        maxX: cx + width / 2,
        minY: cy - height / 2,
        maxY: cy + height / 2
    };
}

/*
 * Is a world point inside a drawn label, allowing a small margin?
 *
 * The margin is added in WORLD units by the caller - converted from the
 * pixels a comfortable target needs at the current zoom - so the
 * forgiveness is the same on screen at any magnification while the
 * label itself keeps its drawing size.
 */
function textBoundsContainPoint(
  bounds,
  point,
  padding = 0
) {
  if (!bounds || !point) {
    return false;
  }

  return (
    point.x >= bounds.minX - padding &&
    point.x <= bounds.maxX + padding &&
    point.y >= bounds.minY - padding &&
    point.y <= bounds.maxY + padding
  );
}

/*
 * Where an annotation should sit when it has not been placed.
 *
 * A position just off the feature's own edge, on the side the
 * feature points towards for a force or a load, and above it
 * otherwise. Deliberately simple and never worth defending at
 * length: this is only the FIRST position, and the student's first
 * adjustment overrides it permanently.
 *
 * Avoidance - scoring candidate positions against the geometry and
 * the other annotations - is the placement tool's job, not this
 * module's, because it needs the whole document and this function
 * deliberately only knows one feature.
 *
 * ========================================================
 * THE ANCHOR IS ASKED FOR, NOT ASSUMED
 * ========================================================
 *
 * The automatic position falls just beyond a vector feature's current
 * arrowhead, and "beyond the arrowhead" is a question about the CURRENT
 * rendered geometry - not about the stored span, which is the engineering
 * vector and is drawn at the shared Visual Force Scale rather than at its own
 * length once the scale leaves 1.
 *
 * So `annotationAnchor` answers that question once, from the force's current
 * drawn geometry, and both this function and a drag ask it - so an annotation
 * that is being dragged is measured against exactly the anchor the renderer
 * is drawing, and the two cannot disagree about where it naturally falls.
 */
function annotationAnchor(
  annotation,
  state
) {
  const object = findObject(
    state,
    annotation.sourceFeatureId
  );

  if (!object) {
    return { ...annotation.placement };
  }

  const geometry = object.geometry || {};

  if (object.type === "moment" && geometry.position) {
    const radius = Number(geometry.arcRadius) || 7;
    const text = textFor(annotation, state) || "";
    const fontSize = Number(annotation.style?.fontSize) || 12;
    const halfWidth = Math.max(...text.split("\n").map(line => line.length), 0) *
      fontSize * TEXT_CHARACTER_WIDTH / 2;
    return {
      x: geometry.position.x + radius * 0.35 + halfWidth,
      y: geometry.position.y - radius - 1
    };
  }

  /*
   * ========================================================
   * THE ANCHOR IS THE CURRENT RENDERED FORCE ENDPOINT
   * ========================================================
   *
   * A force's stored `end` is the ENGINEERING vector - exactly its magnitude
   * away from the application point - while the arrow is DRAWN at the shared
   * Visual Force Scale. Those two are the same number only at 1x: at 2x the
   * arrowhead is twice as far out as the stored end, and a label anchored to
   * the stored end would sit in the middle of its own arrow.
   *
   * So the automatic position is taken from the force's CURRENT RENDERED
   * geometry - `enggLoadProfile.forceGeometry`, which recomputes the drawn
   * endpoint from the application point, the stored magnitude, the stored
   * direction and the current scale. Changing the scale, the magnitude, the
   * direction, or the application point therefore all move the label, because
   * none of them is remembered here: the endpoint is recalculated every time
   * this runs.
   *
   * A LOAD is still measured from its own stored geometry. A distributed
   * load's arrows are a field standing off a span, not a single vector, so
   * the span is the right thing to anchor its label to.
   */
  if (
    object.type === "force" ||
    object.type === "resultant"
  ) {
    const drawn =
      enggLoadProfile &&
      typeof enggLoadProfile.forceGeometry === "function"
        ? enggLoadProfile.forceGeometry(state, geometry)
        : null;

    const end =
      drawn?.end ||
      geometry.end ||
      geometry.position;

    const start =
      drawn?.start ||
      geometry.start ||
      end;

    /*
     * The label sits beyond the arrowhead, along the force's own direction.
     * The direction comes from the drawn geometry, so a reversed force carries
     * its label past the head that is now at the other end of the same line.
     */
    if (end && start) {
      const direction =
        drawn && Number.isFinite(drawn.direction)
          ? unitVectorOf(drawn.direction)
          : normalise({
              x: end.x - start.x,
              y: end.y - start.y
            });

      /*
       * Beyond the arrowhead, by a distance that does not shrink
       * with the arrow. A fraction of the arrow's length put the
       * label back INSIDE a short arrow, which is worse than not
       * suggesting a position at all - it suggests one that covers
       * the thing it is labelling.
       */
      const standoff = 10;

      if (object.type === "force") {
        return {
          x: start.x - direction.x * standoff,
          y: start.y - direction.y * standoff + 1
        };
      }

      return {
        x: end.x + direction.x * standoff,
        y:
          end.y +
          direction.y * standoff -
          4
      };
    }
  }

  if (
    object.type === "load" ||
    object.type === "varying-load"
  ) {
    const end =
      geometry.end || geometry.position;

    const start = geometry.start || end;

    if (end && start) {
      const direction = normalise({
        x: end.x - start.x,
        y: end.y - start.y
      });

      const standoff = 10;

      return {
        x: end.x + direction.x * standoff,
        y:
          end.y +
          direction.y * standoff -
          4
      };
    }
  }

  /*
   * A point feature has no extent to sit beside, so the label goes
   * above and to the right - the conventional place for a name, and
   * clear of the coordinate axes drawn from an origin.
   */
  const anchor =
    enggMeasurement.resolveAnchor(
      object,
      "position"
    ) ||
    enggMeasurement.resolveAnchor(
      object,
      "center"
    ) ||
    geometry.start;

  if (!anchor) {
    return { ...annotation.placement };
  }

  return { x: anchor.x + 10, y: anchor.y - 10 };
}

function suggestPlacement(
  annotation,
  state
) {
  const object = findObject(
    state,
    annotation.sourceFeatureId
  );

  if (!object) {
    return { ...annotation.placement };
  }

  return annotationAnchor(annotation, state);
}

function normalise(vector) {
  const length = Math.hypot(vector.x, vector.y);

  return length < 1e-9
    ? { x: 1, y: 0 }
    : { x: vector.x / length, y: vector.y / length };
}

/*
 * A unit vector for a direction in degrees, read from the shared vector
 * module so a label placed along a force's own direction uses exactly the
 * components the force itself is drawn with - including the axis cleaning
 * that makes a force straight along an axis land exactly on it.
 */
function unitVectorOf(degrees) {
  if (
    enggLoadProfile &&
    typeof enggLoadProfile.unitVector === "function"
  ) {
    const unit = enggLoadProfile.unitVector(degrees);

    return { x: unit.x, y: unit.y };
  }

  const radians = (Number(degrees) || 0) * Math.PI / 180;

  return { x: Math.cos(radians), y: Math.sin(radians) };
}

/*
 * ========================================================
 * LEADERS
 * ========================================================
 */

/*
 * A leader's two ends, in drawing units.
 *
 * Computed fresh every time it is asked for, from the annotation's
 * own placement and the feature's current geometry. That is what
 * makes a leader follow both: move the annotation and its end moves
 * with it, move the feature and the other end moves with it, and
 * neither requires the leader to be stored or re-created.
 *
 * The leader is described, not created. It is not pushed into the
 * document as a Line, so it cannot be selected on its own, cannot
 * appear in the Features list, and cannot outlive the annotation it
 * belongs to.
 */
function leaderFor(
  annotation,
  state
) {
  if (!annotation.leader?.enabled) {
    return null;
  }

  const from = {
    x: annotation.placement.x,
    y: annotation.placement.y
  };

  /*
   * A leader may point at the feature or at somewhere fixed. Fixed
   * is what a caption or a note in a corner of the sheet wants; the
   * default is the feature, which is what an engineering label
   * wants.
   */
  const to =
    annotation.leader.target === "fixed" &&
    annotation.leader.elbow
      ? annotation.leader.elbow
      : anchorFor(annotation, state);

  if (!to) {
    return null;
  }

  /*
   * The line stops short of the feature rather than touching it.
   * A leader whose end sits exactly on a force's arrowhead reads as
   * part of the arrow, and the label then looks like it belongs to
   * the line rather than to the value.
   */
  const trimmed = trim(from, to);

  return {
    from: trimmed.from,
    to: trimmed.to,
    /*
     * The direction the leader runs, so a renderer can put a small
     * termination at the feature end without having to work it out
     * again.
     */
    direction: normalise({
      x: trimmed.to.x - trimmed.from.x,
      y: trimmed.to.y - trimmed.from.y
    })
  };
}

/*
 * Where a leader should attach on the feature.
 *
 * The nearest edge of the feature, so a label sat below a beam has
 * its leader point up at the beam's underside rather than at its
 * centre - which is what makes the leader read as pointing AT the
 * feature rather than crossing it.
 */
function anchorFor(
  annotation,
  state
) {
  const object = findObject(
    state,
    annotation.sourceFeatureId
  );

  if (!object) {
    return annotation.leader.elbow || null;
  }

  const geometry = object.geometry || {};

  /*
   * A feature with an extent contributes the edge nearest the
   * annotation; one without contributes its own point.
   */
  const span = enggMeasurement.twoPointSpan(
    object
  );

  if (span) {
    const reach = Math.hypot(
      span.end.x - span.start.x,
      span.end.y - span.start.y
    );

    const mid = {
      x: (span.start.x + span.end.x) / 2,
      y: (span.start.y + span.end.y) / 2
    };

    /*
     * Offset perpendicular to the span, on whichever side the
     * annotation is, so the leader meets the feature's flank.
     */
    const along = normalise({
      x: span.end.x - span.start.x,
      y: span.end.y - span.start.y
    });

    const side = normalise({
      x: -along.y,
      y: along.x
    });

    const towards =
      (annotation.placement.x - mid.x) * side.x +
        (annotation.placement.y - mid.y) * side.y >=
      0
        ? 1
        : -1;

    const standoff = Math.max(
      4,
      (reach || 10) * 0.1
    );

    return {
      x: mid.x + side.x * standoff * towards,
      y: mid.y + side.y * standoff * towards
    };
  }

  return (
    enggMeasurement.resolveAnchor(
      object,
      "position"
    ) ||
    enggMeasurement.resolveAnchor(
      object,
      "center"
    ) ||
    geometry.position ||
    geometry.start ||
    null
  );
}

/*
 * Stop a leader just short of what it points at.
 */
function trim(from, to) {
  const gap = 3;

  const length = Math.hypot(
    to.x - from.x,
    to.y - from.y
  );

  if (length <= gap) {
    return { from, to };
  }

  const direction = {
    x: (to.x - from.x) / length,
    y: (to.y - from.y) / length
  };

  return {
    from,
    to: {
      x: to.x - direction.x * gap,
      y: to.y - direction.y * gap
    }
  };
}

/*
 * ========================================================
 * RESOLUTION
 * ========================================================
 */

/*
 * Whether an annotation can currently say what it is for.
 *
 * A written annotation always can - it is not about anything. A
 * generated one cannot once its feature has gone, and saying so
 * openly is what stops a deleted force leaving a confident "250 N"
 * pointing at empty space.
 */
function isResolved(
  annotation,
  state
) {
  if (
    annotation.textMode === TEXT_MODES.manual
  ) {
    return true;
  }

  return (
    textFor(annotation, state) !== null
  );
}

/*
 * The annotations that depend on a feature.
 *
 * Returned as a list so a caller can update exactly these and
 * nothing else. This is what makes an edit to one force cost one
 * annotation rather than a sweep of the document: the dependency is
 * resolved from the object's own id, not by asking every annotation
 * whether it cares.
 */
function annotationsFor(
  state,
  featureId
) {
  return (state?.objects || []).filter(
    (object) =>
      object.type === "annotation" &&
      object.sourceFeatureId === featureId
  );
}

/*
 * ========================================================
 * CLEANUP
 * ========================================================
 */

/*
 * What should happen to an annotation whose feature has been deleted.
 *
 * Two kinds of annotation, two answers, and the difference matters:
 *
 *   GENERATED   the text was only ever a reading of the feature, so
 *               there is nothing left. It goes, along with its
 *               leader, because a label of nothing is clutter.
 *
 *   WRITTEN     the student wrote these words. Deleting a force must
 *               not silently destroy something a person typed, so it
 *               is kept and marked unresolved - the text stays, and
 *               it is visibly no longer attached to anything.
 *
 * Automatic cleanup for the first and preservation for the second is
 * what "handle it cleanly" means when the two cases are this
 * different in kind.
 */
function onSourceDeleted(
  annotation
) {
  if (
    isGenerated(annotation.annotationKind) &&
    annotation.textMode !== TEXT_MODES.manual
  ) {
    return { action: "delete" };
  }

  return {
    action: "keep",
    annotation: {
      ...annotation,
      sourceFeatureId: null,
      unresolved: true
    }
  };
}

const enggAnnotationModel = {
  KINDS,
  TEXT_MODES,
  annotationsFor,
  createAnnotation,
  derivedAnnotation,
  derivedAnnotations,
  displaySettingsOf,
  findObject,
  formatNumber,
  isGenerated,
  kindsFor,
  isResolved,
  isVisible,
  magnitudeShownFor,
  annotatableTypes,
  annotationTextBounds,
  annotationAnchor,
  drawnTextBounds,
  featureValueText,
  labelledQuantityText,
  textBoundsContainPoint,
  leaderFor,
  moveAnnotation,
  moveDerivedAnnotation,
  onSourceDeleted,
  releaseToAutomaticPlacement,
  resetDerivedAnnotation,
  suggestPlacement,
  textFor,

  /*
   * THE SUPPORT VALUE SYSTEM, shared with the Features panel.
   *
   * The panel reads the same table and the same state accessors the
   * annotation model uses, so a support's fields and the boxes on the
   * sheet cannot disagree about which values exist, what they say, or
   * whether the Question Mark is on.
   */
  SUPPORT_REACTION_VALUES,
  supportReactionValues,
  supportValueState,
  supportValueText,
  supportValuesHolder,
  isSupportValueType: isSupportType
};

export default enggAnnotationModel;
