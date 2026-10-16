/*
 * ========================================================
 * PLOT MODE EQUATIONS
 * ========================================================
 *
 * A Plot diagram is drawn from expressions the STUDENT typed. This file is
 * the whole of what that means: turning a list of typed relations into
 * points on a frame.
 *
 * It is a separate module from the analysis dependencies because of the
 * one rule that governs all of it:
 *
 *   THE EQUATION IS THE SOURCE OF TRUTH. THE POINTS ARE A SAMPLE OF IT.
 *
 * So sampling happens here, and a sample is never written back onto the
 * feature as if it were the data. A student who plots a curve, moves the
 * frame and plots again gets the same curve - a stored polyline would have
 * frozen at whatever the first sample happened to be, and changing the
 * range would move the vertices rather than re-derive them.
 *
 * NOTHING HERE READS THE RENDERER. The frame, the beam, the vector scale
 * and the arrow sizes are all irrelevant to the value of V(x) at some
 * distance, which is exactly why a diagram here can be trusted: the curve
 * is a function of x alone.
 *
 * AND NOT EVERY RELATION IS A FUNCTION OF x.
 *
 * A diagram carries a mathematical RELATION, and a relation is not
 * necessarily a function. "x = 5 between -10 and 10" is the shape of every
 * jump, boundary and marker a beam diagram has, and no honest function of
 * x can express it. Building the store around functions anyway is what
 * forces those jumps to be faked, so this file is built around relations
 * from the start - see the RELATIONS section below.
 */
/*
 * ========================================================
 * READING AN EQUATION
 * ========================================================
 *
 * A student types something like "10 - 5x" or "4x - x^2". This turns
 * that text into a function of x - without eval, and without a
 * general-purpose parser.
 *
 * WHY NOT eval. A parser that hands typed text to a JavaScript
 * evaluator is a way for a formula box to run code, and a formula box
 * is exactly where a student pastes whatever they were handed. The
 * grammar here accepts a fixed, tiny language and refuses everything
 * else, so an expression it does not understand is reported rather
 * than executed.
 *
 * The language is the small one a beam equation is written in:
 *
 *     10              a constant
 *     10 - 5x         linear
 *     4x - x^2        parabolic
 *     x^3 / 6         cubic
 *     2(3x - 1)       a factor
 *     -x + 4          a leading sign
 *     V(x) = 10       the quantity is a label, not part of the maths
 *
 * THERE IS EXACTLY ONE EVALUATOR. An earlier version of this file
 * parsed the tokens twice - once to validate, once to run - and that
 * is the kind of duplication that lets the check and the calculation
 * drift apart and quietly accept something the drawing cannot do.
 * Validation is not a separate pass: if the evaluator can read the
 * whole token stream then the expression is valid, and it is that
 * same code deciding.
 */

var VARIABLE = "x";

/*
 * A leading "V(x) =" is stripped before anything else looks at the
 * text, and only when it is genuinely there. The quantity is the NAME
 * of the equation - already on the frame and in the panel heading -
 * and not part of it. Anchoring the pattern at the start means
 * brackets appearing later in a real expression are left alone.
 */
var QUANTITY_PREFIX =
    /^\s*[A-Za-z]\s*\(\s*[xX]\s*\)\s*=\s*/;

function tokenize(text) {
    var source = String(text === null || text === undefined
        ? ""
        : text
    ).replace(QUANTITY_PREFIX, "");

    var tokens = [];
    var index = 0;

    while (index < source.length) {
        var char = source[index];

        if (/\s/.test(char)) {
            index++;
            continue;
        }

        if (/[0-9.]/.test(char)) {
            var digits = "";

            while (
                index < source.length &&
                /[0-9.]/.test(source[index])
            ) {
                digits += source[index];
                index++;
            }

            var value = Number(digits);

            /*
             * "1.2.3" is a typo, not a number, and Number() would make
             * it NaN and poison every sample after it.
             */
            if (!isFinite(value)) {
                return null;
            }

            tokens.push({ kind: "number", value: value });

            continue;
        }

        if (/[a-zA-Z]/.test(char)) {
            if (char.toLowerCase() !== VARIABLE) {
                /*
                 * A letter that is not x. "sin" and "pi" are
                 * reasonable to want and are not supported yet;
                 * refusing says so, where guessing would draw
                 * something that merely looks like an answer.
                 */
                return null;
            }

            tokens.push({ kind: "variable" });

            index++;
            continue;
        }

        if ("+-*/^()".indexOf(char) >= 0) {
            tokens.push({ kind: "op", value: char });

            index++;
            continue;
        }

        return null;
    }

    return tokens;
}

/*
 * COULD A FACTOR BEGIN HERE?
 *
 * This is what makes the asterisk optional. Once a factor has been
 * read, the next token continuing the product is a number, an x or an
 * opening bracket. Anything else - another operator, the end of the
 * text, an unrecognised token - ends the product, and the caller then
 * decides what the stray token means.
 */
function startsFactor(token) {
    if (!token) {
        return false;
    }

    if (
        token.kind === "number" ||
        token.kind === "variable"
    ) {
        return true;
    }

    return (
        token.kind === "op" &&
        token.value === "("
    );
}

/*
 * Recursive descent, so the grammar is written as grammar rather than
 * as index arithmetic:
 *
 *     expression := term (('+' | '-') term)*
 *     term       := factor (('*' | '/')? factor)*
 *     factor     := ('-')? primary ('^' factor)?
 *     primary    := number | 'x' | '(' expression ')'
 *
 * The brackets around the star in `term` are what make the asterisk
 * optional, and optional is not a nicety: an equation that required
 * it would refuse nearly everything a student would actually type.
 *
 * The exponent is parsed as a FACTOR, which is what makes 2^-1 and
 * x^2^2 mean what they look like rather than stopping at the first
 * term.
 *
 * Returns null for anything not recognised, INCLUDING a trailing
 * operator. "10 +" is a half-typed equation, and accepting the
 * readable part would draw a wrong answer that looks right.
 */
function evaluate(tokens, x) {
    var position = 0;

    function isOp(value) {
        var token = tokens[position];

        return Boolean(
            token &&
            token.kind === "op" &&
            token.value === value
        );
    }

    function expression() {
        var left = term();

        if (left === null) {
            return null;
        }

        while (isOp("+") || isOp("-")) {
            var operator = tokens[position].value;

            position++;

            var right = term();

            if (right === null) {
                return null;
            }

            left = operator === "+"
                ? left + right
                : left - right;
        }

        return left;
    }

    function term() {
        var left = factor();

        if (left === null) {
            return null;
        }

        while (true) {
            if (isOp("/")) {
                position++;

                var divisor = factor();

                if (divisor === null || divisor === 0) {
                    return null;
                }

                left = left / divisor;

                continue;
            }

            if (isOp("*")) {
                position++;
            } else if (!startsFactor(tokens[position])) {
                break;
            } else if (
                /*
                 * A NUMBER MAY NOT FOLLOW A COMPLETE FACTOR.
                 *
                 * "2(3x - 1)" is a product, and reading the bracket as
                 * an implicit multiply is right. "10 20" is two
                 * numbers, and the same rule would quietly read it as
                 * 10 x 20 - so a mistyped equation would draw a
                 * confident, wrong curve instead of being reported.
                 * The asterisk stays optional; only an adjacency of
                 * number-then-number is refused.
                 */
                tokens[position].kind === "number"
            ) {
                return null;
            }

            var right = factor();

            if (right === null) {
                return null;
            }

            left = left * right;
        }

        return left;
    }

    function factor() {
        var sign = 1;

        while (isOp("-")) {
            sign = -sign;
            position++;
        }

        while (isOp("+")) {
            position++;
        }

        var base = primary();

        if (base === null) {
            return null;
        }

        var value = sign * base;

        if (isOp("^")) {
            position++;

            var exponent = factor();

            if (exponent === null) {
                return null;
            }

            value = Math.pow(value, exponent);
        }

        return value;
    }

    function primary() {
        var token = tokens[position];

        if (!token) {
            return null;
        }

        if (token.kind === "number") {
            position++;

            return token.value;
        }

        if (token.kind === "variable") {
            position++;

            return x;
        }

        if (isOp("(")) {
            position++;

            var inner = expression();

            if (inner === null || !isOp(")")) {
                return null;
            }

            position++;

            return inner;
        }

        return null;
    }

    var result = expression();

    if (
        result === null ||
        position !== tokens.length ||
        !isFinite(result)
    ) {
        return null;
    }

    return result;
}

/*
 * A checked equation: a function that yields null rather than NaN, so
 * one bad sample can be skipped instead of putting a hole in the whole
 * curve.
 */
function equationFor(text) {
    var tokens = tokenize(text);

    if (!tokens || !tokens.length) {
        return null;
    }

    return function (x) {
        var value = evaluate(tokens, x);

        return isFinite(value) ? value : null;
    };
}

/*
 * ========================================================
 * RELATIONS, NOT SEGMENTS
 * ========================================================
 *
 * A Plot is a LIST of EXPRESSIONS, and an expression is a RELATION -
 * a mathematical relationship between two quantities. There is more
 * than one kind of relationship, and the most important thing this
 * module does is REFUSE to pretend otherwise.
 *
 * The obvious way to build a plot is "a list of functions of x", and
 * that way makes it impossible to draw
 *
 *     x = 5,  -10 <= V <= 10
 *
 * which is not a function of x at all. There is one x and many values
 * of V, so a y = f(x) renderer has nothing honest to say about it. The
 * usual workarounds are all worse than useless: a huge value, a
 * reciprocal, a "nearly vertical" function. Every one of them DRAWS
 * SOMETHING THAT IS NOT WHAT WAS ASKED FOR, and a graph that lies
 * about a jump in shear force is worse than no graph.
 *
 * So a vertical line is a first-class relation here, stored as
 *
 *     { relationType: "verticalLine", x: 5, yRange: {...} }
 *
 * and rendered from that, directly. There is no conversion step, and
 * there is deliberately nowhere in this file that could perform one.
 *
 * THE REGISTRY IS A TABLE, NOT A SWITCH, so a third kind of relation -
 * a point, a parametric curve, an implicit curve - can be added later
 * without touching the normaliser, the validator or the renderer.
 */

var RELATION_TYPES = {
    functionX: {
        id: "functionX",

        /*
         * The words the interface uses. A student is choosing what
         * kind of relationship they are drawing; they are not choosing
         * an enum value.
         */
        label: "Function of x",
        shortLabel: "Function"
    },

    verticalLine: {
        id: "verticalLine",
        label: "Vertical Line",
        shortLabel: "Vertical Line"
    }
};

var SAMPLES_PER_EXPRESSION = 40;

/*
 * A range, read the way a student means it.
 *
 * A range typed backwards is a slip, not an error - "5 to 2" is how
 * people say it out loud - so it is read the way it was meant rather
 * than refused, which would leave the student to work out why.
 *
 * Returns null when the numbers are not numbers, because a range that
 * is not a range cannot be drawn against and must not be guessed at.
 */
function normaliseRange(raw, fallback) {
    var supplied =
        raw &&
        (raw.start !== undefined ||
            raw.end !== undefined ||
            raw.from !== undefined ||
            raw.to !== undefined);

    var from = Number(
        raw && raw.start !== undefined
            ? raw.start
            : raw && raw.from
    );

    var to = Number(
        raw && raw.end !== undefined
            ? raw.end
            : raw && raw.to
    );

    if (!isFinite(from) || !isFinite(to)) {
        /*
         * A SUPPLIED RANGE THAT IS NOT A RANGE IS REFUSED, even when
         * there is a default that could stand in for it.
         *
         * Substituting the whole body for a mistyped "2 - 5" would
         * quietly widen the expression across the entire member and
         * draw a confident, wrong curve. An absent range may take the
         * default, because nothing was asked for; a broken one was
         * asked for and cannot be answered.
         */
        if (supplied || !fallback) {
            return null;
        }

        return {
            start: Number(fallback.start),
            end: Number(fallback.end)
        };
    }

    return {
        start: Math.min(from, to),
        end: Math.max(from, to)
    };
}

/*
 * WHICH RELATION IS THIS?
 *
 * Asked of stored data rather than assumed, because the answer decides
 * which fields are meaningful - showing an "x range" on a vertical line
 * would be offering a control that does nothing.
 *
 * An old file that stored `{from, to, equation}` is a function, and
 * that is read directly rather than converted into a fake shape: the
 * legacy fields are simply where the range and the equation live for
 * that relation.
 */
function relationTypeOf(raw) {
    var declared = String(
        (raw && raw.relationType) || ""
    ).trim();

    if (RELATION_TYPES[declared]) {
        return declared;
    }

    /*
     * `x` is how a vertical line is stored and nothing else is, so its
     * presence is what identifies one. It is checked BEFORE the
     * equation, because a legacy entry that happens to carry an `x`
     * alongside its equation is describing a vertical relation and not
     * a function.
     */
    if (raw && isFinite(Number(raw.x)) && raw.x !== "") {
        return "verticalLine";
    }

    return "functionX";
}

/*
 * ONE EXPRESSION, IN ITS OWN TERMS.
 *
 * The output is deliberately uniform - every relation has an `id` and a
 * `relationType`, and the rest is whatever that kind of relation
 * actually needs - so a caller can hold a heterogeneous list and read
 * the type first. That is what makes the list extensible: adding a
 * relation type means adding its fields here, not changing every
 * consumer.
 *
 * `id` IS STABLE AND IS NOT THE POSITION. Expressions are reordered
 * and deleted, and "expression 2" is not a thing that can be
 * referred to; the id is, which is what lets a card, an undo entry and
 * a saved file all mean the same expression.
 */
function normaliseExpression(raw, index, defaults) {
    if (!raw || typeof raw !== "object") {
        return null;
    }

    var relationType = relationTypeOf(raw);

    var base = {
        id: String(
            raw.id ||
            `expr-${index}-${relationType}`
        ),

        relationType: relationType,

        /*
         * Visibility is presentation, not mathematics. A hidden
         * expression keeps its place in the list and its identity, and
         * is simply not sampled - so hiding one and showing it again
         * restores exactly what was there.
         */
        visible: raw.visible !== false
    };

    if (relationType === "verticalLine") {
        var x = Number(raw.x);

        if (!isFinite(x)) {
            return null;
        }

        var yRange = normaliseRange(
            raw.yRange || raw,
            defaults && defaults.verticalRange
        );

        if (!yRange) {
            return null;
        }

        return {
            ...base,
            x: x,
            yRange: yRange
        };
    }

    var xRange = normaliseRange(
        raw.xRange || raw,
        defaults && defaults.xRange
    );

    if (!xRange) {
        return null;
    }

    return {
        ...base,
        xRange: xRange,
        expression: String(
            raw.expression !== undefined
                ? raw.expression
                : raw.equation || ""
        ).replace(/^\s+|\s+$/g, "")
    };
}

/*
 * A whole list, normalised. Anything that cannot be read at all is
 * dropped rather than kept in a half-formed state, because a
 * half-formed expression is one that will be drawn wrongly.
 */
function normaliseExpressions(list, defaults) {
    return (list || [])
        .map(function (raw, index) {
            return normaliseExpression(
                raw,
                index,
                defaults
            );
        })
        .filter(Boolean);
}

/*
 * THE ENTRY EVERY CALLER GOES THROUGH.
 *
 * Every public function here takes "a plot's expressions", and a plot
 * may have been stored either way - as the current relations or as the
 * original `{from, to, equation}` segments. Rather than making each
 * caller know which, this is asked once and answers with the current
 * shape either way.
 *
 * It is the ONLY place the two spellings meet. Everything below works
 * in terms of relations, so there is exactly one conversion rather
 * than a check in every branch - which is what stops an old segment
 * list and a new expression list being handled by two subtly different
 * code paths.
 */
function toExpressions(list, defaults) {
    var entries = Array.isArray(list) ? list : [];

    var legacy = entries.some(function (entry) {
        return (
            entry &&
            !entry.relationType &&
            entry.equation !== undefined
        );
    });

    return normaliseExpressions(
        legacy ? fromLegacySegments(entries) : entries,
        defaults
    );
}

/*
 * ========================================================
 * SAMPLING
 * ========================================================
 *
 * ONE MARK PER EXPRESSION, returned as a LIST, and never joined.
 *
 * That is what preserves a discontinuity. Two functions meeting at
 * different values stay two strokes, because joining them would assert
 * a value for the distance where the jump happens, and there is no
 * such value. A single path has no way to say "do not connect these".
 *
 * A vertical line comes back as a mark of its OWN kind, carrying the
 * x it is at and the two values it spans. It is not converted into
 * points on a curve, because it is not a curve: there is no function
 * here, and the renderer is told so directly.
 */
function sampleExpression(expression, options) {
    if (!expression || expression.visible === false) {
        return null;
    }

    if (expression.relationType === "verticalLine") {
        /*
         * A vertical line has a POSITION and a RANGE. It is returned
         * as read, with no attempt to find a function behind it.
         */
        return {
            kind: "verticalLine",
            id: expression.id,
            x: expression.x,
            from: expression.yRange.start,
            to: expression.yRange.end
        };
    }

    var equation = equationFor(expression.expression);

    if (!equation) {
        return null;
    }

    var width =
        expression.xRange.end -
        expression.xRange.start;

    /*
     * An expression of no width has nothing to draw across, and
     * dividing by it would loop rather than fail.
     */
    if (!(width > 0)) {
        return null;
    }

    var samples =
        (options && options.samplesPerExpression) ||
        SAMPLES_PER_EXPRESSION;

    var steps = Math.max(2, samples);
    var points = [];

    for (var i = 0; i <= steps; i++) {
        var x =
            expression.xRange.start +
            width * (i / steps);

        var value = equation(x);

        if (value !== null) {
            points.push({ x: x, value: value });
        }
    }

    return points.length > 1
        ? {
            kind: "curve",
            id: expression.id,
            points: points
        }
        : null;
}

function sampleExpressions(expressions, options) {
    return toExpressions(expressions)
        .map(function (expression) {
            return sampleExpression(
                expression,
                options
            );
        })
        .filter(Boolean);
}

/*
 * ========================================================
 * CHECKING
 * ========================================================
 *
 * PER EXPRESSION, not as one global verdict.
 *
 * A problem is attached to the expression that has it, so the editor
 * can say it on the card the student is looking at. A single
 * "CHECKS" block listing everything in the document is a list the
 * student has to match up by hand against the thing they are editing,
 * which is exactly the work this is meant to be saving them.
 *
 * Reported, never repaired. A range running past the end of the beam
 * is the student having made a mistake, and quietly clamping it would
 * draw a diagram that looks right and is not - the one thing a
 * diagram must never be.
 */
function validateExpressions(expressions, range) {
    var problems = [];
    var byId = {};

    var entries = toExpressions(expressions);

    entries.forEach(function (expression, index) {
        var entry = {
            id: expression.id,
            index: index,
            problems: []
        };

        byId[expression.id] = entry;

        if (expression.relationType === "verticalLine") {
            /*
             * A vertical line is checked against the BODY in x only.
             * Its y range is engineering values, not a distance along
             * the member, so the beam's length says nothing about it.
             */
            if (
                range &&
                (expression.x < range.from - 1e-6 ||
                    expression.x > range.to + 1e-6)
            ) {
                entry.problems.push(
                    "This line is at x = " + expression.x +
                    ", outside the body."
                );
            }

            if (
                expression.yRange.end -
                    expression.yRange.start ===
                0
            ) {
                entry.problems.push(
                    "A vertical line needs a y range with a height."
                );
            }

            return;
        }

        if (!equationFor(expression.expression)) {
            entry.problems.push(
                "Enter an expression, such as \"10 - 5x\"."
            );
        }

        if (!range) {
            return;
        }

        if (
            expression.xRange.start < range.from - 1e-6 ||
            expression.xRange.end > range.to + 1e-6
        ) {
            entry.problems.push(
                "This range runs outside the body."
            );
        }
    });

    /*
     * FUNCTIONS ONLY. Overlap and gap are questions about the domain
     * of a function, and a vertical line is not part of the domain -
     * it is a mark AT a distance, and it is supposed to sit on the
     * boundary of the two regions either side of it. Including it
     * would report every correctly drawn jump as a collision.
     */
    var functions = entries.filter(
        function (expression) {
            return (
                expression.relationType !==
                    "verticalLine" &&
                equationFor(expression.expression)
            );
        }
    ).slice().sort(function (a, b) {
        return a.xRange.start - b.xRange.start;
    });

    for (var i = 1; i < functions.length; i++) {
        var previous = functions[i - 1];
        var current = functions[i];

        if (
            byId[previous.id] &&
            byId[current.id]
        ) {
            if (
                current.xRange.start >
                previous.xRange.end + 1e-6
            ) {
                byId[previous.id].problems.push(
                    "Nothing is plotted between this and the next expression."
                );
            } else if (
                current.xRange.start <
                previous.xRange.end - 1e-6
            ) {
                byId[previous.id].problems.push(
                    "This range overlaps the previous expression."
                );
            }
        }
    }

    /*
     * DOES THE PLOT COVER THE BODY?
     *
     * A diagram that starts late or stops early is describing part of
     * a member, and the student has no way to see that from the curve
     * alone - the missing part is simply blank, which looks like a
     * deliberate choice. So it is said, here, where it can be fixed.
     */
    if (!range) {
        if (entries.length) {
            problems.push({
                id: null,
                index: 0,
                message:
                    "No source body, so the range cannot be checked."
            });
        }
    } else if (!functions.length) {
        if (!entries.length) {
            problems.push({
                id: null,
                index: 0,
                message: "No expressions yet."
            });
        }
    } else {
        if (
            functions[0].xRange.start >
            range.from + 1e-6
        ) {
            byId[functions[0].id].problems.push(
                "The diagram starts at " +
                functions[0].xRange.start +
                ", not at the end of the body."
            );
        }

        var last =
            functions[functions.length - 1];

        if (last.xRange.end < range.to - 1e-6) {
            byId[last.id].problems.push(
                "The diagram stops at " +
                last.xRange.end +
                ", short of the end of the body."
            );
        }
    }

    problems = problems.concat(
        entries.reduce(function (all, expression) {
            var entry = byId[expression.id];

            if (!entry || !entry.problems.length) {
                return all;
            }

            return all.concat(
                entry.problems.map(function (problem) {
                    return {
                        id: expression.id,
                        index: entry.index,
                        message: problem
                    };
                })
            );
        }, [])
    );

    return {
        valid: problems.length === 0,
        problems: problems,
        byId: byId
    };
}

/*
 * The largest magnitude anywhere in the diagram, which is what sets the
 * frame's vertical scale. Sampled rather than solved, so it is the same
 * answer the drawn curve actually has and cannot disagree with what is
 * on screen.
 *
 * A VERTICAL LINE COUNTS. Its endpoints are values on the same scale
 * as everything else, and a jump reaching to -5 has to fit in the
 * frame - otherwise the diagram would be scaled to the functions
 * either side of it and the jump would run off the paper, which reads
 * as the jump not being there at all.
 */
function peakMagnitude(expressions) {
    var peak = 0;

    sampleExpressions(expressions).forEach(function (mark) {
        if (mark.kind === "verticalLine") {
            peak = Math.max(
                peak,
                Math.abs(mark.from),
                Math.abs(mark.to)
            );

            return;
        }

        mark.points.forEach(function (point) {
            var magnitude = Math.abs(point.value);

            if (magnitude > peak) {
                peak = magnitude;
            }
        });
    });

    return peak;
}

/*
 * ========================================================
 * THE LEGACY SHAPE
 * ========================================================
 *
 * `segments` was the original store: a list of `{from, to, equation}`,
 * which was a function of x and nothing else. A drawing saved before
 * relations existed still has to open, and it has to open as what it
 * always was - functions - rather than being refused or, worse, being
 * reshaped into something it never was.
 *
 * So it is READ as expressions here, once, at the edge. Nothing
 * downstream of this function knows the old name existed.
 */
function fromLegacySegments(segments) {
    return (segments || []).map(function (segment, index) {
        return {
            id: String(
                (segment && segment.id) ||
                `seg-${index}`
            ),
            relationType: "functionX",
            expression: String(
                (segment && segment.equation) || ""
            ),
            xRange: { start: segment.from, end: segment.to }
        };
    });
}

/*
 * THE PLOT DEFINITION AS A WHOLE.
 *
 * Normalised once, here, so the panel, the editor, the renderer and
 * the tests all read the same shape. A caller holding either the
 * legacy segments or the current expressions gets the current
 * expressions back - which is what lets the two coexist in one file
 * during the change rather than needing a migration pass.
 */
function readPlot(geometry) {
    if (!geometry) {
        return [];
    }

    return toExpressions(
        Array.isArray(geometry.expressions)
            ? geometry.expressions
            : geometry.segments,
        {
            xRange: geometry.localRange,
            verticalRange: geometry.localRange
                ? {
                    start: -1,
                    end: 1
                }
                : null
        }
    );
}

/*
 * ========================================================
 * WHAT EACH DIAGRAM CALLS ITS QUANTITY
 * ========================================================
 *
 * The symbol is generated, never typed. A student working out a
 * bending moment diagram writes M(x), and the tool already knows
 * which of the three quantities they are looking at, so asking them
 * to choose the letter would be asking them to restate the tool
 * choice they have already made - and would let the two disagree.
 *
 * The same table gives the Popup its title, so "SFD" never appears
 * in one place and "Shear Force Diagram" in another.
 *
 * `quantity` is the LEFT-HAND SIDE, as a reader writes it. What is
 * stored is the right-hand side: the student types `10 - 5x` into
 * the field labelled `V(x) =`, and the diagram's symbol is
 * prepended by the interface rather than becoming part of the
 * mathematics.
 */
var DIAGRAM_QUANTITIES = {
    sfd: {
        id: "sfd",
        quantity: "V(x)",
        title: "Shear Force Diagram"
    },
    bmd: {
        id: "bmd",
        quantity: "M(x)",
        title: "Bending Moment Diagram"
    },
    afd: {
        id: "afd",
        quantity: "N(x)",
        title: "Axial Force Diagram"
    }
};

/*
 * The quantity symbol for a diagram type, or a neutral `f(x)` for
 * something that is not one of the three. The fallback is a last
 * resort rather than a normal answer, so a fourth diagram type would
 * need a row here before it could be labelled.
 */
function quantityFor(diagramType) {
    var entry = DIAGRAM_QUANTITIES[diagramType];

    return entry ? entry.quantity : "f(x)";
}

function titleFor(diagramType) {
    var entry = DIAGRAM_QUANTITIES[diagramType];

    return entry ? entry.title : "Analysis Diagram";
}

/*
 * ========================================================
 * A NEW EXPRESSION, BUILT IN ITS OWN TERMS
 * ========================================================
 *
 * The one place an expression is created, so every caller agrees on
 * what a fresh one looks like.
 *
 * IT IS SEEDED FROM WHAT IS ALREADY THERE. A Plot opens with one
 * function spanning the body, because the range is not the student's
 * to work out - it is the body's own, and asking for it invites the
 * one error that matters, a plot that does not line up with the
 * member above it. What the student still has to supply is the
 * equation, which is the part that is genuinely theirs.
 *
 * `xRange` is passed on, not invented, and a vertical line is given
 * a SPAN of the body's own rather than ±1: the ordinate of a
 * diagram has the same units as the quantity, so a default of -1 to
 * 1 would be a number in the wrong unit entirely, and a jump would
 * be seeded at the wrong size on every diagram.
 */
function createExpression(type, options) {
    var settings = options || {};

    var id =
        settings.id ||
        "expr-" +
            DIAGRAM_COUNTER.next() +
            "-" +
            type;

    if (type === "verticalLine") {
        return {
            id: id,
            relationType: "verticalLine",
            visible: true,
            x: Number.isFinite(settings.x)
                ? settings.x
                : 0,
            yRange: normaliseRange(
                settings.yRange,
                settings.verticalRange
            ) || { start: -1, end: 1 }
        };
    }

    return {
        id: id,
        relationType: "functionX",
        visible: true,
        xRange: normaliseRange(
            settings.xRange,
            settings.defaultRange
        ) || { start: 0, end: 1 },
        expression: String(settings.expression || "")
    };
}

/*
 * Ids are COUNTERS, not array positions.
 *
 * Expression 1 is deleted, expression 2 becomes expression 1, and a
 * counter cannot be confused for either: two expressions can never
 * share an id however the list is edited, reordered or restored from
 * a file. A counter rather than a timestamp so two expressions
 * created in the same millisecond still differ.
 */
var DIAGRAM_COUNTER = {
    value: 0,

    next: function () {
        DIAGRAM_COUNTER.value += 1;

        return DIAGRAM_COUNTER.value;
    }
};

const enggDiagramEquations = {
    equationFor: equationFor,
    RELATION_TYPES: RELATION_TYPES,
    DIAGRAM_QUANTITIES: DIAGRAM_QUANTITIES,
    quantityFor: quantityFor,
    titleFor: titleFor,
    createExpression: createExpression,
    SAMPLES_PER_EXPRESSION: SAMPLES_PER_EXPRESSION,
    normaliseRange: normaliseRange,
    normaliseExpression: normaliseExpression,
    normaliseExpressions: normaliseExpressions,
    toExpressions: toExpressions,
    validateExpressions: validateExpressions,
    sampleExpression: sampleExpression,
    sampleExpressions: sampleExpressions,
    peakMagnitude: peakMagnitude,
    fromLegacySegments: fromLegacySegments,
    readPlot: readPlot,

    /*
     * The names the previous store used, kept so an existing caller -
     * and an existing test - keeps answering the same question. They
     * are aliases onto the relation model, not a second
     * implementation, so the two cannot drift apart.
     */
    normaliseSegment: function (segment, index) {
        var expression = normaliseExpression(
            segment,
            index
        );

        return expression
            ? {
                id: expression.id,
                from: expression.xRange.start,
                to: expression.xRange.end,
                equation: expression.expression
            }
            : null;
    },
    validateSegments: function (segments, range) {
        var check = validateExpressions(
            segments,
            range
        );

        return {
            valid: check.valid,
            problems: check.problems.map(function (problem) {
                return "Expression " + (problem.index + 1) +
                    ": " + problem.message;
            })
        };
    },
    sampleSegments: function (segments, options) {
        return sampleExpressions(segments, options)
            .filter(function (mark) {
                return mark.kind === "curve";
            })
            .map(function (mark) {
                return mark.points;
            });
    }
};

export default enggDiagramEquations;
