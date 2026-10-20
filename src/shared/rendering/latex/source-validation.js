/*
 * ============================================================
 * SOURCE VALIDATION
 * ============================================================
 *
 * What can be said about a piece of drawing source WITHOUT compiling it: which
 * statements never finished, which delimiters are unbalanced, whether the
 * picture is whole, and which commands the renderer cannot honour.
 *
 * WHAT IT IS NOT.
 *
 * It is not a LaTeX parser, and it does not pretend to be one. A mistake inside a
 * well-formed command is only certain once TeX has read it, so the LAST word
 * belongs to the renderer, and its answer arrives through the canvas. This
 * module's job is to catch what does not need TeX to recognise - and to do it
 * without ever throwing away the student's text.
 *
 * THE THREE SEVERITIES, AND WHY THEY ARE KEPT APART.
 *
 *   error    the source cannot be rendered as written. The diagnostic carries
 *            its exact source RANGE (`start`/`end` offsets and `line`/`endLine`),
 *            so the editor paints it and the student can click it.
 *
 *   warning  a non-fatal problem: a command the renderer cannot honour, a marker
 *            that is not paired, an id that appears twice. The drawing still
 *            renders; the student should know.
 *
 *   info     an observation that is not a problem at all (there is no
 *            `tikzpicture`; DAETUM will wrap the commands).
 *
 * PARTIAL RESULTS ARE THE POINT. One unfinished statement produces ONE error,
 * naming its own range; every other statement is still validated, still
 * rendered, and still an object. The whole document is never marked failed
 * because one line is being typed.
 *
 * AN EMPTY DOCUMENT IS NOT AN ERROR. A drawing with nothing on it is a
 * legitimate state - a new sheet, a cleared sheet - and the Source tab owes the
 * student a clean editor, not a complaint. (This used to be reported as an
 * error, which is what made a fresh Source tab open showing one.)
 */

import { PICTURE_BEGIN, PICTURE_END, isObjectMarkerLine, parseDrawingSource } from "./drawing-source.js";
import { SUPPORTED, splitStatements, unsupportedStatements } from "./source-statements.js";

/* A delimiter and the one that closes it. */
const OPENING = { "{": "}", "(": ")", "[": "]" };

/* Whether `character` at `index` is escaped by an odd number of backslashes. */
function escapedAt(text, index) {
  let backslashes = 0;

  for (let back = index - 1; back >= 0 && text[back] === "\\"; back -= 1) {
    backslashes += 1;
  }

  return backslashes % 2 === 1;
}

/*
 * The first closing delimiter in a statement that closes nothing, or null.
 *
 * A statement the scanner already found unfinished is not asked this question -
 * it has its own, clearer diagnostic - so the answer here is always about a
 * statement that is otherwise complete.
 */
function firstStrayClosing(statementText, offset) {
  const open = [];

  for (let index = 0; index < statementText.length; index += 1) {
    const character = statementText[index];

    if (character === "%" && !escapedAt(statementText, index)) {
      /* A comment runs to the end of its line. */
      const newline = statementText.indexOf("\n", index);

      if (newline < 0) {
        break;
      }

      index = newline;
      continue;
    }

    if (character === "\\") {
      index += 1;
      continue;
    }

    if (OPENING[character]) {
      open.push(character);
      continue;
    }

    if (character === "}" || character === ")" || character === "]") {
      if (!open.length) {
        /* Only a brace is unambiguous; a bare `)` or `]` can be text. */
        if (character === "}") {
          return { index: offset + index, character };
        }

        continue;
      }

      if (OPENING[open[open.length - 1]] === character) {
        open.pop();
      }
    }
  }

  return null;
}

/* What a statement left open, spelled for a student. */
function describeOpen(statement) {
  const names = { "}": "brace", ")": "parenthesis", "]": "option bracket" };
  const characters = statement.open || "";

  if (!characters) {
    return "the command is not finished (no closing \";\")";
  }

  return characters
    .split("")
    .map((character) => `a "${character}" is never closed (${names[character] || "delimiter"})`)
    .join(" and ");
}

/* The first line of a statement, shortened, for a diagnostic's label. */
function statementLabel(statement) {
  const first = statement.text.split("\n")[0].trim();

  return first.length > 60 ? `${first.slice(0, 57)}...` : first;
}

/* The character offset at which a line begins. */
function offsetOfLine(text, line) {
  if (line <= 0) {
    return 0;
  }

  let offset = 0;

  for (let index = 0; index < text.length && line > 0; index += 1) {
    if (text[index] === "\n") {
      line -= 1;
      offset = index + 1;
    }
  }

  return offset;
}

/* ============================================================
 * VALIDATE
 * ============================================================
 *
 * Returns:
 *
 *   ok           no error-severity diagnostic
 *   empty        nothing to draw at all
 *   hasPicture   whether the text contains `\begin{tikzpicture}`
 *   diagnostics  [{ severity, kind, message, line, endLine, start, end }]
 *                - `line` is ONE-BASED (what the editor shows)
 *                - `start`/`end` are CHARACTER OFFSETS, so the editor can
 *                  highlight the exact text rather than search for it
 *   statements   every statement, for callers that need the structure
 *   blocks       the marker blocks, in document order
 *   supported    what the renderer can honour
 */
export function validateDrawingSource(source) {
  const text = String(source ?? "");
  const diagnostics = [];
  const statements = splitStatements(text);

  const add = (diagnostic) => {
    diagnostics.push({
      severity: "error",
      line: 1,
      endLine: null,
      start: null,
      end: null,
      kind: "syntax",
      ...diagnostic
    });
  };

  const hasPicture = statements.some((statement) => statement.name === "begin-tikzpicture");

  if (text.trim() === "") {
    return {
      ok: true,
      empty: true,
      diagnostics: [],
      blocks: [],
      statements,
      hasPicture: false,
      supported: SUPPORTED
    };
  }

  /* ---- 1. statements that never finished ---- */
  statements.forEach((statement) => {
    if (statement.kind === "prologue") {
      return;
    }

    if (statement.complete) {
      const stray = firstStrayClosing(statement.text, statement.start);

      if (stray) {
        add({
          message: `Unexpected "${stray.character}" - there is no delimiter open for it to close.`,
          line: statement.startLine + 1,
          endLine: statement.endLine + 1,
          start: stray.index,
          end: stray.index + 1
        });
      }

      return;
    }

    /*
     * A STATEMENT THAT IS SENDABLE IS NOT AN ERROR HERE.
     *
     * It is a command that ran out of file without its `;`. That is either a
     * half-typed line (which needs the student, not a diagnosis) or a command
     * TeX will reject (which only TeX can say, and does - through the renderer's
     * own error). Calling it broken here would report the second case wrongly,
     * and would report the first as an error while the student is still typing.
     * The status line shows a quiet "incomplete command" note instead - see the
     * Source tab - and nothing stops rendering.
     */
    if (statement.sendable) {
      return;
    }

    add({
      message: `This drawing command is unfinished: ${describeOpen(statement)}. Everything else still renders.`,
      line: statement.startLine + 1,
      endLine: statement.endLine + 1,
      start: statement.start,
      end: statement.end,
      label: statementLabel(statement)
    });
  });

  /* ---- 2. a picture that was opened and never closed ---- */
  const lastBegin = statements.filter((statement) => statement.name === "begin-tikzpicture").pop();
  const lastEnd = statements.filter((statement) => statement.name === "end-tikzpicture").pop();

  if (lastBegin && (!lastEnd || lastEnd.start < lastBegin.start)) {
    add({
      message: `The picture is never closed - it needs ${PICTURE_END}.`,
      line: lastBegin.startLine + 1,
      start: lastBegin.start,
      end: lastBegin.end
    });
  }

  /* ---- 3. the markers that make an object's region findable ---- */
  const begins = statements.filter((statement) => statement.kind === "marker-begin").length;
  const ends = statements.filter((statement) => statement.kind === "marker-end").length;

  if (begins !== ends) {
    add({
      severity: "warning",
      kind: "marker",
      message: `${begins} object marker${begins === 1 ? "" : "s"} but ${ends} closing marker${
        ends === 1 ? "" : "s"
      }. An object may not be mapped until its markers are paired.`,
      line: 1
    });
  }

  const blocks = parseDrawingSource(text);
  const seen = new Map();
  const lines = text.split("\n");

  blocks.forEach((block) => {
    const beginOffset = offsetOfLine(text, block.beginLine);
    const beginLength = (lines[block.beginLine] || "").length;

    if (seen.has(block.id)) {
      add({
        severity: "warning",
        kind: "mapping",
        message: `Object id "${block.id}" appears more than once. Only the first region is updated.`,
        line: block.beginLine + 1,
        start: beginOffset,
        end: beginOffset + beginLength
      });
    } else {
      seen.set(block.id, block);
    }

    if (block.unclosed) {
      add({
        severity: "warning",
        kind: "marker",
        message: `Object "${block.id}" has a BEGIN marker with no END marker.`,
        line: block.beginLine + 1,
        start: beginOffset,
        end: beginOffset + beginLength
      });
    }
  });

  /* ---- 4. commands the renderer cannot honour ---- */
  unsupportedStatements(text).forEach((warning) => {
    add({
      severity: "warning",
      kind: "unsupported",
      message: warning.message,
      line: warning.startLine + 1,
      endLine: warning.endLine + 1,
      start: warning.start,
      end: warning.end
    });
  });

  /* ---- 5. a picture is recommended; a bare command list is allowed ---- */
  if (!hasPicture && statements.filter((statement) => statement.kind === "command" || statement.kind === "environment").length) {
    add({
      severity: "info",
      kind: "format",
      message: "No tikzpicture found. DAETUM will wrap these commands in one when rendering."
    });
  }

  return {
    ok: !diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    empty: false,
    diagnostics,
    blocks,
    statements,
    hasPicture,
    supported: SUPPORTED,
    begin: PICTURE_BEGIN,
    end: PICTURE_END
  };
}

/*
 * A compact, human-readable summary for the Source tab's status line. Kept
 * beside the validation so the wording and the severity test cannot drift.
 */
export function validationSummary(validation) {
  if (!validation) {
    return "";
  }

  const count = (severity) =>
    (validation.diagnostics || []).filter((item) => item.severity === severity).length;

  const errors = count("error");
  const warnings = count("warning");

  if (errors) {
    return errors === 1 ? "1 error" : `${errors} errors`;
  }

  if (warnings) {
    return warnings === 1 ? "1 warning" : `${warnings} warnings`;
  }

  return "";
}

/* The errors, in document order. */
export function errorDiagnostics(validation) {
  return (validation?.diagnostics || [])
    .filter((diagnostic) => diagnostic.severity === "error")
    .sort((left, right) => (left.start ?? 0) - (right.start ?? 0));
}

/* The warnings and notes, in document order. */
export function advisoryDiagnostics(validation) {
  return (validation?.diagnostics || []).filter((diagnostic) => diagnostic.severity !== "error");
}

export { isObjectMarkerLine };

export default {
  validateDrawingSource,
  validationSummary,
  errorDiagnostics,
  advisoryDiagnostics
};
