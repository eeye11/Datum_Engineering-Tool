/*
 * ============================================================
 * SOURCE VALIDATION
 * ============================================================
 *
 * What can be said about a piece of drawing source WITHOUT compiling it: is it
 * balanced, does it sit inside a picture, are its DAETUM markers well formed.
 * These are the checks that can run on every keystroke, cheaply, and they exist
 * so a student gets an answer before a render is even attempted.
 *
 * WHAT THIS IS NOT.
 *
 * It is not a LaTeX parser and it does not pretend to be one. A syntax error in
 * the middle of a command is only certain once TeX has read it, so the LAST word
 * belongs to the renderer, and its answer arrives through the rendering adapter.
 * This module's job is to catch the mistakes that do not need TeX to recognise -
 * and to do it without ever throwing away the student's text.
 *
 * A diagnostic never replaces or edits the source. The draft is the student's;
 * this only describes it.
 */

import { createSourceMap, isObjectMarkerLine, parseDrawingSource } from "./drawing-source.js";

/*
 * THE COMMANDS THAT REACH THE COMPILER - the source minus its object markers.
 *
 * Markers are comments, which TeX ignores, so they are harmless either way - but
 * they are not part of the drawing, and a check that counts them would report a
 * false problem in a picture whose every object is a comment.
 */
function drawableSource(text) {
  return String(text ?? "")
    .split("\n")
    .filter((line) => !isObjectMarkerLine(line))
    .join("\n")
    .trim();
}

/*
 * Strip LaTeX comments so a `%` inside a comment cannot unbalance the brace
 * count. A comment runs to the end of the line unless the `%` is escaped, which
 * is why the check looks at the character before it.
 */
function withoutComments(line) {
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] !== "%") {
      continue;
    }

    let backslashes = 0;

    for (let back = index - 1; back >= 0 && line[back] === "\\"; back -= 1) {
      backslashes += 1;
    }

    if (backslashes % 2 === 0) {
      return line.slice(0, index);
    }
  }

  return line;
}

/*
 * Count braces over the whole text, ignoring comments. A `\{` or `\}` is an
 * escaped literal and does not count, so it is removed first.
 */
function braceBalance(text) {
  const stripped = text
    .replace(/\\[{}]/g, "")
    .split("\n")
    .map(withoutComments)
    .join("\n");

  let depth = 0;

  for (const character of stripped) {
    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
    }
  }

  return depth;
}

/*
 * ============================================================
 * PARENTHESES AND OPTION BRACKETS
 * ============================================================
 *
 * In TikZ a `(` opens a coordinate and a `[` opens an option list; both are
 * ALWAYS paired on a path or node command. A `\draw (0,0 -- (10,0);` is the
 * canonical half-typed command, and it is not a brace problem - the braces are
 * balanced - so counting braces alone lets it through.
 *
 * It used to, and the result was a source that was SENT to the compiler and
 * only rejected there. The student saw a render failure for a mistake that was
 * knowable in the editor, and the "nothing was sent" guarantee the canvas
 * documents was quietly false for this whole class of typo.
 *
 * Counted the same way as braces: comments are stripped, and an ESCAPED
 * bracket - `\(`, `\)`, `\[`, `\]`, which are literal text in LaTeX rather than
 * grouping - does not count. A `\left(` / `\right)` pair is text too, but the
 * count of each character is what matters: `\left(` has one `(` and `\right)`
 * has one `)`, so the pair balances either way.
 *
 * A mismatch is reported as an error, because no well-formed drawing source
 * has one. Text inside `\node {..}` is not special-cased: a literal parenthesis
 * there must be written `\(`, exactly as in LaTeX, so a raw `(` in node text is
 * the same mistake as a raw `(` in a coordinate.
 */
function groupBalance(text, open, close) {
  const stripped = text
    .replace(new RegExp(`\\\\[${open}${close}]`, "g"), "")
    .split("\n")
    .map(withoutComments)
    .join("\n");

  let depth = 0;

  for (const character of stripped) {
    if (character === open) {
      depth += 1;
    } else if (character === close) {
      depth -= 1;
    }
  }

  return depth;
}

/*
 * ============================================================
 * VALIDATE A DRAWING SOURCE
 * ============================================================
 *
 * Returns `{ ok, diagnostics, blocks }`. `ok` is true when nothing would stop
 * the source from being sent to the renderer. A warning - an unclosed marker,
 * a duplicate id - leaves `ok` true, because the source may still compile and
 * the student may be halfway through typing.
 */
export function validateDrawingSource(source) {
  const text = String(source ?? "");
  const diagnostics = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  if (drawableSource(text) === "") {
    diagnostics.push({
      severity: "error",
      line: 1,
      message:
        "The drawing source is empty. Add TikZ commands to draw something.",
    });

    return { ok: false, diagnostics, blocks: [] };
  }

  const balance = braceBalance(text);

  if (balance !== 0) {
    diagnostics.push({
      severity: "error",
      line: lines.length,
      message:
        balance > 0
          ? `${balance} unclosed brace${balance === 1 ? "" : "s"} - a "{" with no matching "}".`
          : `${-balance} extra closing brace${balance === -1 ? "" : "s"} "}".`,
    });
  }

  /*
   * A COORDINATE OR AN OPTION LIST LEFT OPEN. See `groupBalance` for why these
   * are separate from the brace count and why a mismatch is an error.
   */
  const parens = groupBalance(text, "(", ")");

  if (parens !== 0) {
    diagnostics.push({
      severity: "error",
      line: lines.length,
      message:
        parens > 0
          ? `${parens} unclosed parenthesis - a "(" with no matching ")". A path coordinate must be closed.`
          : `${-parens} extra closing parenthesis ")".`,
    });
  }

  const brackets = groupBalance(text, "[", "]");

  if (brackets !== 0) {
    diagnostics.push({
      severity: "error",
      line: lines.length,
      message:
        brackets > 0
          ? `${brackets} unclosed option bracket - a "[" with no matching "]".`
          : `${-brackets} extra closing option bracket "]".`,
    });
  }

  const begins = lines.filter((line) =>
    /DAETUM_OBJECT_BEGIN/.test(line),
  ).length;
  const ends = lines.filter((line) => /DAETUM_OBJECT_END/.test(line)).length;

  if (begins !== ends) {
    diagnostics.push({
      severity: "warning",
      line: 1,
      message: `${begins} object marker${begins === 1 ? "" : "s"} but ${ends} closing marker${
        ends === 1 ? "" : "s"
      }. An object may not be mapped until its markers are paired.`,
    });
  }

  const blocks = parseDrawingSource(text);
  const seen = new Map();

  blocks.forEach((block) => {
    if (seen.has(block.id)) {
      diagnostics.push({
        severity: "warning",
        line: block.beginLine + 1,
        message: `Object id "${block.id}" appears more than once. Only the first region is updated.`,
      });
    } else {
      seen.set(block.id, block);
    }

    if (block.unclosed) {
      diagnostics.push({
        severity: "warning",
        line: block.beginLine + 1,
        message: `Object "${block.id}" has a BEGIN marker with no END marker.`,
      });
    }
  });

  /*
   * A picture is not required to render - the server wraps the input in a
   * document and will accept a bare \draw - but a drawing source SHOULD be a
   * picture, because that is what "the source that generates the drawing"
   * means. Its absence is reported as a note rather than an error.
   */
  if (!/\\begin\s*\{tikzpicture\}/.test(text)) {
    diagnostics.push({
      severity: "info",
      line: 1,
      message:
        "No tikzpicture found. DAETUM will wrap this code in a tikzpicture when rendering.",
    });
  }

  /*
   * AN EMPTY PICTURE IS A VALID DRAWING.
   *
   * A sheet with nothing on it is exactly `\begin{tikzpicture}` /
   * `\end{tikzpicture}`, and that compiles to a blank sheet - which is the
   * honest picture of an untouched drawing. It used to be reported as an error,
   * so a NEW DOCUMENT could not be rendered at all until something was drawn,
   * and a deletion that emptied a sheet failed the same way. Only a source with
   * NO PICTURE AT ALL and no commands is an error.
   */
  const drawable = drawableSource(text);

  if (!/\\begin\s*\{tikzpicture\}/.test(drawable) && drawable === "") {
    diagnostics.push({
      severity: "error",
      line: 1,
      message: "The drawing source is empty. Add TikZ commands to draw something.",
    });
  }

  const ok = !diagnostics.some((diagnostic) => diagnostic.severity === "error");

  return { ok, diagnostics, blocks };
}

/*
 * A compact, human-readable summary for the Source tab's status line. Kept
 * beside the validation so the wording and the severity test cannot drift.
 */
export function validationSummary(validation) {
  if (!validation) {
    return "";
  }

  const errors = validation.diagnostics.filter(
    (item) => item.severity === "error",
  );
  const warnings = validation.diagnostics.filter(
    (item) => item.severity === "warning",
  );

  if (errors.length) {
    return errors.length === 1 ? "1 error" : `${errors.length} errors`;
  }

  if (warnings.length) {
    return warnings.length === 1 ? "1 warning" : `${warnings.length} warnings`;
  }

  return "";
}

/*
 * The map, exposed here too so a caller validating and mapping in one step does
 * not have to import the same module twice.
 */
export { createSourceMap };

export default {
  validateDrawingSource,
  validationSummary,
};
