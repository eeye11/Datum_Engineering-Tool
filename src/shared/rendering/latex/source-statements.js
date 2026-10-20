/*
 * ============================================================
 * DRAWING STATEMENTS - SPLITTING, RECOVERY AND THE RENDER INPUT
 * ============================================================
 *
 * The editable source is hand-written LaTeX/TikZ. Everything else in the
 * pipeline - validation, partial rendering, the source -> object mapping - needs
 * to know where ONE COMMAND ENDS. This module is the one place that answers it.
 *
 * WHY NOT LINES.
 *
 * A TikZ command is not a line. It may run over several lines:
 *
 *     \draw[black]
 *         (0,0) -- (10,0)
 *         node[midway,above] {$F$};
 *
 * and a node's text may contain a brace group, a `%` comment, or an option list
 * spanning lines. Deleting the physical line that "looks wrong" therefore
 * deletes part of a command that is mostly fine, or leaves the other half of an
 * invalid one behind. So statements are found by SCANNING - braces, brackets and
 * parentheses, with comments skipped - and recovery operates on whole
 * statements.
 *
 * WHAT COUNTS AS A STATEMENT.
 *
 *   prologue     a whole `\begin{tikzpicture}` / `\end{tikzpicture}`
 *   command      `\name[...]{...}(...) ... ;` - one TikZ/LaTeX command
 *   environment  `\begin{name}` ... `\end{name}` for anything that is not the
 *                picture (a scope, a matrix, a pgfonlayer)
 *   raw          text that does not begin with a command (a stray `)`, a line
 *                of prose)
 *
 * A statement knows its own line and character range in the text it was found
 * in, whether it is COMPLETE (it was closed by `;`, by its group, or by its
 * environment end), and - when it is not - what is still open at the end. That
 * is the whole of what recovery needs.
 *
 * COMMENTS ARE NOT STATEMENTS, and they are never removed: a comment on its own
 * line before a command belongs to that command for the purposes of the region
 * sweep, so a student's explanation of a drawing step stays with the step.
 */

/*
 * THIS MODULE HAS NO IMPORTS, DELIBERATELY. It is the bottom of the source
 * pipeline - drawing-source.js, the manager, validation and the object reader
 * all use it - so it must not reach back into any of them. A dependency in the
 * wrong direction would be a module cycle.
 */

/* The commands whose statement ends at `;`. */
const SEMICOLON_COMMANDS = new Set([
  "draw", "fill", "filldraw", "shade", "shadedraw", "clip", "path", "node",
  "coordinate", "useasboundingbox", "pgfresetboundingbox", "foreach",
  "matrix", "graph", "datavisualization", "pic", "pattern", "cd"
]);

/* A command whose arguments are brace groups and whose statement ends there. */
const GROUP_COMMANDS = new Set([
  "usetikzlibrary", "tikzset", "setlength", "newcommand",
  "renewcommand", "providecommand", "DeclareMathOperator", "def",
  "pgfmathsetmacro", "pgfmathparse", "color", "colorlet", "definecolor",
  "newenvironment", "input", "include", "label", "ref", "textbf", "emph",
  "footnotesize", "small", "normalsize", "itshape", "bfseries", "centering",
  "caption", "hspace", "vspace", "quad", "qquater", "par", "noindent",
  "pagestyle", "thispagestyle", "setmainfont", "documentclass", "usepackage"
]);

/* Environments that are part of the drawing but not the picture itself. */
const NESTED_ENVIRONMENTS = new Set([
  "scope", "pgfonlayer", "pgfonlayer*", "matrix", "fit", "axis", "semilogyaxis",
  "semilogxaxis", "groupplot", "tikzcd", "aligned", "align", "equation",
  "equation*", "gather", "itemize", "enumerate", "center", "minipage",
  "tabular", "figure"
]);

/* A name a TikZ command can have: letters, `*`, and the `@` internal form. */
const COMMAND_NAME = /^\\([A-Za-z@]+\*?|.)/;

/* ============================================================
 * SCANNING HELPERS
 * ============================================================ */

function lineIndexAt(text) {
  const starts = [0];

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") {
      starts.push(index + 1);
    }
  }

  return (offset) => {
    let low = 0;
    let high = starts.length - 1;

    while (low < high) {
      const middle = (low + high + 1) >> 1;

      if (starts[middle] <= offset) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }

    return low;
  };
}

function lineEndAt(text, offset) {
  const end = text.indexOf("\n", offset);

  return end < 0 ? text.length : end;
}

/*
 * The index of the `%` that starts a comment at `index`, or -1. A `%` is a
 * comment when an EVEN number of backslashes precede it: `\%` is a literal, and
 * `\\%` is a line break followed by a comment.
 */
function commentIndexAt(text, index) {
  let backslashes = 0;

  for (let back = index - 1; back >= 0 && text[back] === "\\"; back -= 1) {
    backslashes += 1;
  }

  return backslashes % 2 === 0 ? index : -1;
}

/*
 * Skip a group that may span lines and nest braces.
 *
 * Returns `{ end, closed }`: `end` is the index after the group, or the index of
 * the newline at which an UNCLOSED group is abandoned. A command whose `(` is
 * never closed (`\draw (0,0 -- (10,0);`) is the canonical half-typed TikZ
 * mistake, and it must not swallow the rest of the document - so the scan stops
 * at the end of that line and the statement is reported incomplete.
 */
function skipGroup(text, index, open, close) {
  if (text[index] !== open) {
    return { end: index, closed: false, opened: false };
  }

  let depth = 0;

  for (let at = index; at < text.length; at += 1) {
    const character = text[at];

    if (character === "%" && commentIndexAt(text, at) >= 0) {
      at = lineEndAt(text, at);
      continue;
    }

    if (character === "\n" && depth > 0) {
      /*
       * AN OPTION LIST MAY SPAN LINES; COORDINATES MAY NOT. `[` options are
       * routinely wrapped by hand and by formatters, and a `\draw (0,0) --
       * (10,0)` is ordinary. A `(` or `{` left open at a newline is a typo.
       */
      if (open === "[") {
        continue;
      }

      return { end: at, closed: false, opened: true };
    }

    if (character === "\\") {
      at += 1;
      continue;
    }

    if (character === open) {
      depth += 1;
    } else if (character === close) {
      depth -= 1;

      if (depth === 0) {
        return { end: at + 1, closed: true, opened: true };
      }
    }
  }

  /* End of text with the group still open. */
  return { end: text.length, closed: false, opened: true };
}

/* The body of one command, from just after `\name` to the end of its statement. */
function scanCommand(text, start, name) {
  let index = start + 1 + name.length;

  /*
   * THE TWO WAYS A STATEMENT CAN BE SENT.
   *
   *   endedByDelimiter  a `;` or a group that finishes the command.
   *   endedByNewline    a new command began at the start of the next line, so
   *                     this one ran out of file without its `;`.
   *
   * Both may be complete as far as the scanner can tell - and only the first is
   * PROOF. A command that ended at a newline may be a typo (`\BROKEN`) that TeX
   * will reject, so it is still sent, but it is not reported as complete.
   */
  let endedByDelimiter = false;
  let endedByNewline = false;

  /* The delimiter the scan was still inside when it stopped, if any. */
  let unclosed = "";

  const isEnvironment = name === "begin" || name === "end";

  for (let guard = 0; guard < 100000 && index < text.length; guard += 1) {
    const character = text[index];

    if (character === "%" && commentIndexAt(text, index) >= 0) {
      index = lineEndAt(text, index);
      continue;
    }

    if (character === "\\") {
      /* An escaped character (`\%`, `\{`) is content, not structure. */
      index += 2;
      continue;
    }

    if (character === "#") {
      /*
       * A PGFPLAIN COLOUR IN AN OPTION LIST, `[#112233]`. `#` is TeX's macro
       * parameter character and would end the group in the real compiler, but
       * DAETUM's own writers emit this form and every renderer they target
       * accepts it - so it is content here, not a structure error.
       */
      index += 1;
      continue;
    }

    if (isEnvironment) {
      if (character === "{") {
        const group = skipGroup(text, index, "{", "}");

        /* `\begin{tikzpicture}` alone is a complete statement. */
        if (group.opened && group.closed) {
          endedByDelimiter = true;
          index = group.end;
          break;
        }

        if (group.opened && !group.closed) {
          /* An unclosed `\begin{...` is a broken statement, not a command. */
          index = group.end;
          break;
        }

        index = group.end;
        continue;
      }
    }

    if (character === "[") {
      index = skipGroup(text, index, "[", "]").end;
      continue;
    }

    if (character === "{" || character === "(") {
      /*
       * A GROUP IS ONLY PART OF THE STATEMENT WHEN THE COMMAND HAS MORE TO SAY.
       *
       * `\draw (0,0) -- (1,1)` reaches its first `(` at the start of its
       * coordinates, so a `(` never ends a command. A `{` may: for a command
       * that takes text (`\textbf{...}`) the group IS the command.
       */
      const group = skipGroup(text, index, character, character === "{" ? "}" : ")");
      const next = group.closed ? nextSignificant(text, group.end) : null;

      /*
       * AN UNCLOSED GROUP IS NOT YET THE END OF THE QUESTION. `skipGroup`
       * abandons an unclosed `{` or `(` at its line's end, so the statement is
       * finished at that newline - and whether it is really unbalanced is
       * decided by counting the whole statement below. A `(0,0 -- (100,0)`
       * never closes its FIRST parenthesis, and only the total says so.
       */
      if (group.opened && !group.closed) {
        endedByNewline = true;
      }

      if (
        group.closed &&
        character === "{" &&
        GROUP_COMMANDS.has(name) &&
        !SEMICOLON_COMMANDS.has(name) &&
        (next === null || next === "\n")
      ) {
        endedByDelimiter = true;
        index = group.end;
        break;
      }

      index = group.end;
      continue;
    }

    if (character === ";") {
      endedByDelimiter = true;
      index += 1;
      break;
    }

    /*
     * A NEW COMMAND AT THE START OF A LINE MEANS THE PREVIOUS ONE WAS NEVER
     * CLOSED. That is the half-typed `\draw (0,0 -` followed by `\draw (3,0)`:
     * the second command is independent, and swallowing it into the first would
     * lose a statement that is perfectly good.
     *
     * Only a semicolon-terminated command can be cut short this way: a group
     * command (`\textbf{...}`, `\color{...}`) is finished by its own group and
     * may be followed on the next line by anything at all.
     */
    /*
     * A NEW COMMAND AT THE START OF A LINE ENDS THIS ONE.
     *
     * `\draw[black] (0,0) -- (40,0)` followed by a `node[midway]` continues:
     * the node is a decoration ON the path. A command that is not one of those
     * continuations - another `\draw`, a `\node at (..)`, a `\node` on its own
     * line - is a NEW statement, and if this one had no `;` before it, it never
     * had one at all.
     */
    if (character === "\n" && SEMICOLON_COMMANDS.has(name) && startsCommandAtLine(text, index + 1)) {
      const next = text.slice(nextCommandIndex(text, index + 1), nextCommandIndex(text, index + 1) + 40);
      const continues = /^\\(node|child|edge)\s*(\[[^\]]*\])?\s*(\{|\(?\s*(results|pos)|$)/.test(next);

      if (!continues) {
        endedByNewline = true;
        break;
      }
    }

    index += 1;
  }

  return {
    end: Math.min(index, text.length),
    complete: endedByDelimiter,
    sent: endedByDelimiter || endedByNewline,
    unclosed
  };
}

/* The index of the first command that starts after `index`, or `index`. */
function nextCommandIndex(text, index) {
  let at = index;

  while (at < text.length && (text[at] === " " || text[at] === "\t")) {
    at += 1;
  }

  return at;
}

/*
 * THE DELIMITERS A STATEMENT LEAVES OPEN, in the order it started them.
 *
 * Comments run to the end of their line and an escaped character (`\{`) is
 * content, so neither contributes. The answer is spelled as the closing
 * character of each unclosed pair, because that is what the student has to type.
 */
function unclosedDelimiters(statementText) {
  const closers = { "{": "}", "(": ")", "[": "]" };
  const stack = [];

  for (let at = 0; at < statementText.length; at += 1) {
    const character = statementText[at];

    if (character === "%") {
      let backslashes = 0;

      for (let back = at - 1; back >= 0 && statementText[back] === "\\"; back -= 1) {
        backslashes += 1;
      }

      if (backslashes % 2 === 0) {
        const newline = statementText.indexOf("\n", at);

        if (newline < 0) {
          break;
        }

        at = newline;
        continue;
      }
    }

    if (character === "\\") {
      at += 1;
      continue;
    }

    if (closers[character]) {
      stack.push(character);
      continue;
    }

    if (character === "}" || character === ")" || character === "]") {
      if (stack.length && closers[stack[stack.length - 1]] === character) {
        stack.pop();
      }
    }
  }

  return [...new Set(stack.map((open) => closers[open]))].join("");
}

/* Whether the text at `index` begins a new command (after spaces). */
function startsCommandAtLine(text, index) {
  let at = index;

  while (at < text.length && (text[at] === " " || text[at] === "\t")) {
    at += 1;
  }

  return text[at] === "\\";
}

function nextSignificant(text, index) {
  let at = index;

  while (at < text.length) {
    const character = text[at];

    if (character === " " || character === "\t" || character === "\r" || character === "\n") {
      at += 1;
      continue;
    }

    if (character === "%" && commentIndexAt(text, at) >= 0) {
      at = lineEndAt(text, at);
      continue;
    }

    return character;
  }

  return null;
}

/* ============================================================
 * SPLITTING THE SOURCE INTO STATEMENTS
 * ============================================================
 *
 * Returns every statement in document order with absolute character offsets
 * into the text it was given. Comments, blank lines and marker lines are NOT
 * statements; a caller that needs them (the render input) keeps the text
 * between statements untouched.
 *
 * Each statement: { kind, name, env, start, end, startLine, endLine, complete,
 *                   open }.
 *
 * `startLine`/`endLine` are ZERO-BASED, like every other line number in the
 * drawing-source modules; the Source tab adds one for display.
 */
export function splitStatements(source) {
  const text = String(source ?? "");
  const statements = [];
  const lineOf = lineIndexAt(text);

  let index = 0;

  while (index < text.length) {
    const lineStart = index === 0 || text[index - 1] === "\n";

    if (!lineStart) {
      index += 1;
      continue;
    }

    const end = lineEndAt(text, index);
    const line = text.slice(index, end);

    if (line.trim() === "" || /^\s*%/.test(line)) {
      /*
       * MARKERS, COMMENTS AND BLANK LINES ARE NOT STATEMENTS. Their text is kept
       * by every caller that copies the document, so a region sweep never loses
       * it; they are simply not something the drawing can be asked to do.
       */
      index = end + 1;
      continue;
    }

    let at = index;

    while (at < end && (text[at] === " " || text[at] === "\t")) {
      at += 1;
    }

    if (text[at] !== "\\") {
      statements.push({
        kind: "raw",
        name: "",
        start: index,
        end,
        startLine: lineOf(index),
        endLine: lineOf(end),
        complete: false,
        open: ""
      });
      index = end + 1;
      continue;
    }

    const nameMatch = COMMAND_NAME.exec(text.slice(at));

    if (!nameMatch) {
      index = end + 1;
      continue;
    }

    const name = nameMatch[1];

    if (name === "begin" || name === "end") {
      const braceAt = at + 1 + name.length;
      const group = skipGroup(text, braceAt, "{", "}");
      const env = text.slice(braceAt + 1, Math.max(braceAt + 1, group.end - 1)).trim();
      const statementEnd = Math.max(group.end, at + 1 + name.length);

      if (name === "begin" && env === "tikzpicture") {
        /* The picture's own opening line, with any options after it. */
        const optionEnd = skipGroup(text, statementEnd, "[", "]").end;

        statements.push({
          kind: "prologue",
          name: "begin-tikzpicture",
          start: index,
          end: optionEnd,
          startLine: lineOf(index),
          endLine: lineOf(optionEnd),
          complete: true,
          open: ""
        });

        index = Math.max(optionEnd, statementEnd) + 1;
        continue;
      }

      if (name === "begin") {
        /*
         * MATCHING THE ENVIRONMENT BY NAME, WITH NESTING. A `\begin{scope}`
         * may contain another `\begin{scope}`, and the one this statement ends
         * at is the one that leaves the depth at zero. Environments of a
         * different name do not affect the depth - each is matched by the scan
         * that starts at its own `\begin`.
         */
        const closing = /\\(begin|end)\s*\{([^}]*)\}/g;
        closing.lastIndex = statementEnd;

        let depth = 1;
        let match;

        while ((match = closing.exec(text))) {
          if (match[2].trim() !== env) {
            continue;
          }

          depth += match[1] === "begin" ? 1 : -1;

          if (depth === 0) {
            break;
          }
        }

        if (match && NESTED_ENVIRONMENTS.has(env)) {
          const endOffset = match.index + match[0].length;

          statements.push({
            kind: "environment",
            name: env,
            env,
            start: index,
            end: endOffset,
            startLine: lineOf(index),
            endLine: lineOf(endOffset),
            complete: true,
            open: ""
          });

          index = lineEndAt(text, endOffset) + 1;
          continue;
        }
      }

      /* `\end{tikzpicture}` and a stray environment end. */
      const statement = {
        kind: env === "tikzpicture" ? "prologue" : "command",
        name: name === "end" ? `end-${env}` : `begin-${env}`,
        env,
        start: index,
        end: statementEnd,
        startLine: lineOf(index),
        endLine: lineOf(statementEnd),
        complete: true,
        open: ""
      };

      statements.push(statement);
      index = statementEnd + 1;
      continue;
    }

    const scanned = scanCommand(text, at, name);

    /*
     * A command that ran to the end of an unclosed group reports the group it
     * is inside, so a diagnostic can name the real problem.
     */
    let open = "";

    if (!scanned.complete) {
      /*
       * BOTH HALVES OF "WHY IS THIS NOT FINISHED", KEPT APART.
       *
       * `open`   a brace, bracket or parenthesis is still open. That is a real
       *          syntax error, knowable without TeX, and the statement cannot be
       *          sent - a document containing it stops compiling from there.
       *
       * `open === ""` for a command that ended at a newline instead: it ran out
       *          of file without its `;`. That may be a command that is entirely
       *          well-formed (`\BROKEN`) or a line halfway through being typed,
       *          and only TeX can tell - so it IS sent, and its rejection is the
       *          diagnosis.
       */
      open = unclosedDelimiters(text.slice(index, scanned.end));
    }

    const endOffset = Math.max(scanned.end, at + 1 + name.length);

    /*
     * A COMMAND THAT IS NOT SENT IS NOT SENT BY MISTAKE - it is not sent because
     * it cannot be. Those are different things and they are told apart here:
     *
     *   open === ""      it ran out of file without a `;`. The command may be
     *                    entirely well-formed (`\BROKEN`), or the student may be
     *                    halfway through typing it. Only TeX can tell, so it is
     *                    SENT - and if TeX rejects it, THAT is the diagnosis.
     *
     *   open !== ""      a brace, bracket or parenthesis is still open. No TeX
     *                    document containing it can compile from that point, and
     *                    sending it would fail the whole picture instead of the
     *                    one statement - so it is skipped in the render input.
     */
    statements.push({
      kind: "command",
      name,
      start: index,
      end: endOffset,
      startLine: lineOf(index),
      endLine: lineOf(endOffset),
      complete: scanned.complete,
      open,
      /* The renderer can be given this statement as it stands. */
      sendable: scanned.sent && open === ""
    });

    index = lineEndAt(text, endOffset) + 1;
  }

  /*
   * EVERY STATEMENT CARRIES ITS OWN TEXT, attached here rather than at each of
   * the six places one is pushed. Its `start`/`end` are offsets into the source
   * it was found in, so this is a slice - and a caller holding a statement never
   * has to slice the document again or remember which text it came from.
   */
  statements.forEach((statement) => {
    statement.text = text.slice(statement.start, statement.end);
  });

  return statements;
}

/* ============================================================
 * WHAT THE PARSED SOURCE LOOKS LIKE AT THE DOCUMENT LEVEL
 * ============================================================ */

/*
 * The structural problems of a source: the picture, its boundaries and the
 * statements that never finished. Delimiters are counted PER STATEMENT as well
 * as over the text, so one half-typed command is not attributed to the whole
 * document.
 */
export function sourceStructure(source) {
  const text = String(source ?? "");
  const statements = splitStatements(text);
  const commands = statements.filter((statement) => statement.kind === "command");

  const begins = statements.filter((statement) => statement.name === "begin-tikzpicture");
  const ends = statements.filter((statement) => statement.name === "end-tikzpicture");

  const broken = commands.filter((statement) => !statement.complete);

  return {
    text,
    statements,
    commands,
    begins,
    ends,
    broken,
    hasPicture: begins.length > 0,
    /* Statements that can be handed to the renderer without recovery. */
    recoverable: broken.length > 0
  };
}

/* ============================================================
 * THE RENDER INPUT
 * ============================================================
 *
 * THE AUTHORITATIVE SOURCE IS NEVER EDITED TO PRODUCE A PICTURE.
 *
 * Given the draft, this produces a SEPARATE text for the renderer in which every
 * INCOMPLETE statement is replaced - not deleted - by a comment naming it:
 *
 *     % DAETUM skipped an incomplete statement: \draw (0,0 --
 *
 * The comment is valid TeX, so the picture still compiles, and the skipped code
 * is still visible in the text the student typed. Comments between statements,
 * complete statements, nested environments and the picture itself are copied
 * through byte for byte.
 *
 * Returns { text, skipped, changed } where `skipped` names each statement that
 * was left out, with its line numbers in the DRAFT (so a diagnostic can point at
 * the student's own text, not at this prepared copy).
 *
 * A source with no statements at all (an empty document) is returned as it is.
 * A source that is not inside a picture is wrapped, through the adapter's own
 * `wrapForRendering` rule - see the caller.
 */
export function prepareRenderInput(source) {
  const text = String(source ?? "");
  const statements = splitStatements(text);
  /*
   * THE STATEMENTS THE COMPILER CANNOT BE GIVEN. A statement that merely lacks
   * its `;` is sendable - see `sendable` above - so a command TeX will reject is
   * sent and rejected, which is the honest diagnosis; only the ones with an open
   * delimiter are replaced.
   */
  const broken = statements.filter(
    (statement) => statement.kind !== "prologue" && !statement.complete && statement.sendable !== true
  );

  /*
   * PACKAGE COMMANDS THE RENDERER CANNOT HONOUR ARE ALSO COMMENTED OUT.
   *
   * They are PRESERVED in the draft and reported as warnings, but sending
   * `\includegraphics{...}` - or a package DAETUM's preamble does not load - to
   * the compiler would fail the WHOLE document, blanking a drawing whose own
   * commands are perfectly good. Commenting it here keeps the picture; the
   * student's line is untouched and still visible in the Source tab.
   */
  const unsupported = unsupportedStatements(text).filter(
    (warning) => !statements.some((statement) => statement.start === warning.start && !statement.complete)
  );

  const skippedStatements = [...broken, ...unsupported.map((warning) => ({
    start: warning.start,
    end: warning.end,
    startLine: warning.startLine,
    endLine: warning.endLine,
    name: "unsupported",
    open: "",
    unsupported: true
  }))].sort((left, right) => left.start - right.start);

  if (!skippedStatements.length) {
    return { text, skipped: [], changed: false };
  }

  let result = "";
  let position = 0;

  skippedStatements.forEach((statement) => {
    result += text.slice(position, statement.start);

    const firstLine = text.slice(statement.start, lineEndAt(text, statement.start)).trim();

    /*
     * THE COMMENT NAMES THE COMMAND, NOT ITS HALF-TYPED ARGUMENTS.
     *
     * The whole first line used to be copied into the comment, which is fine
     * until the line is `\draw (0,0 -- (10,0);` - an UNCLOSED parenthesis. A
     * `%` makes it a comment to TeX, but the validator that decides whether
     * a source may be sent counts delimiters in the text, not in the code the
     * compiler will read. So the skipped statement came back as a syntax error
     * of its own, and the canvas refused to send a drawing it had already made
     * harmless - leaving the student's own mistake reported twice and the last
     * good picture stale.
     *
     * The command's NAME and its first few words say everything a reader needs
     * ("a skipped \draw") and can never contain an unbalanced delimiter from
     * the part that was never finished.
     */
    const named = String(statement.name || "command").replace(/[^\w*]/g, "") || "command";

    const excerpt = firstLine.replace(/\s+/g, " ").slice(0, 40);

    result += statement.unsupported
      ? `% DAETUM kept this line but cannot render it: ${excerpt}`
      : `% DAETUM skipped an incomplete \\${named} statement (line ${statement.startLine + 1})`;

    result += text.slice(lineEndAt(text, statement.start), statement.end);

    position = statement.end;
  });

  result += text.slice(position);

  return {
    text: result,
    skipped: skippedStatements.map((statement) => ({
      name: statement.name,
      startLine: statement.startLine,
      endLine: statement.endLine,
      open: statement.open,
      unsupported: Boolean(statement.unsupported)
    })),
    changed: true
  };
}

/* ============================================================
 * STATEMENTS THAT ARE NOT DAETUM DRAWING CODE
 * ============================================================
 *
 * The renderer understands TikZ. Its preamble supplies tikz, amsmath, amssymb,
 * xcolor, arrows.meta, calc and decorations.pathmorphing - and nothing else.
 * A command outside that set is not necessarily an error (the server strips a
 * document preamble), but a package command whose package is NOT loaded cannot
 * compile, and it cannot be turned into geometry either.
 *
 * The list is deliberately FINITE and states exactly what is supported. A
 * command that is not in it is treated as a package request only when it is a
 * known package-shaped command (`\usepackage`, `\includegraphics`, ...). An
 * unknown TikZ operation is left alone: guessing would drop code that works.
 */
const SUPPORTED_PACKAGES = new Set(["tikz", "amsmath", "amssymb", "xcolor", "amsfonts", "amstext"]);

const PACKAGE_SHAPED = new Set([
  "includegraphics", "usepackage", "documentclass", "bibliography", "cite",
  "input", "include", "twocolumn", "tableofcontents", "maketitle", "caption",
  "ref", "label", "autoref", "hyperref", "url", "href"
]);

/*
 * Commands DAETUM's own writers produce, plus the primitives a student may type.
 * Anything else that is a TikZ *operation* is still acceptable - TikZ resolves
 * it - so this set is only used for the package-level warning below.
 */
const SUPPORTED_TIKZ_OPTIONS = new Set([
  "tikzpicture", "scope", "draw", "fill", "filldraw", "shade", "shadedraw",
  "clip", "path", "node", "coordinate", "foreach", "pic", "matrix", "graph",
  "useasboundingbox", "pgfresetboundingbox", "begin", "end"
]);

/*
 * The single statements that name a package or a file the renderer cannot load.
 * Returned so the Source tab can show a WARNING - never an error, and never a
 * deletion.
 */
export function unsupportedStatements(source) {
  const text = String(source ?? "");
  const statements = splitStatements(text);
  const found = [];

  statements.forEach((statement) => {
    if (statement.kind !== "command") {
      return;
    }

    if (statement.name === "usepackage" || statement.name === "documentclass") {
      const argument = text.slice(statement.start, statement.end);
      const packageName = /\{([^}]*)\}/.exec(argument);

      if (packageName) {
        const wanted = packageName[1].split(",").map((entry) => entry.trim()).filter(Boolean);
        const missing = wanted.filter((name) => !SUPPORTED_PACKAGES.has(name));

        if (missing.length) {
          found.push({
            severity: "warning",
            start: statement.start,
            end: statement.end,
            startLine: statement.startLine,
            endLine: statement.endLine,
            message: `\\${statement.name}{${missing.join(",")}} is not available to DAETUM's renderer. The line is kept but will not affect the picture.`,
            kind: "unsupported"
          });
        }
      }

      return;
    }

    if (PACKAGE_SHAPED.has(statement.name)) {
      found.push({
        severity: "warning",
        start: statement.start,
        end: statement.end,
        startLine: statement.startLine,
        endLine: statement.endLine,
        message: `\\${statement.name} is not a drawing command DAETUM renders. The code is kept as it is.`,
        kind: "unsupported"
      });
    }
  });

  return found;
}

export const SUPPORTED = Object.freeze({
  packages: [...SUPPORTED_PACKAGES],
  tikzOperations: [...SUPPORTED_TIKZ_OPTIONS]
});

export default {
  splitStatements,
  sourceStructure,
  prepareRenderInput,
  unsupportedStatements,
  SUPPORTED
};
