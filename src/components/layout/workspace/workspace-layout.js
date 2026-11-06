/*
 * The zoom box and the collapsible side panels.
 */

import { renderCurrentDrawing } from "./canvas-render.js";
import { drawingFeaturesPanelToggle, drawingTopBarShow, drawingToolPanelToggle, drawingTopRail, drawingZoomIn, drawingZoomValue, headerHideButton } from "../../../features/workspace/dom.js";
import { editorState } from "../../../features/workspace/editor-state.js";
import { updateDrawingZoom } from "./viewport.js";

/*
 * ========================================================
 * THE DRAWING'S TOP BARS: HIDE AND SHOW
 * ========================================================
 *
 * The drawing has two rows of chrome above the canvas - the global tool bar
 * and the tool-type bar - and they take vertical space the drawing could use.
 * This folds them away so the canvas grows into the room they gave up.
 *
 * WHAT IT IS NOT.
 *
 * It does not hide the DAETUM header, the document name, or the Written
 * Solution / Engineering Drawing tabs. Those identify the application and
 * choose which page is open; they are not the drawing's chrome, and hiding
 * them would take away the things a student uses to know where they are and
 * to reach the other half of the application. Only the two DRAWING bars go.
 *
 * A THIRD VISIBILITY CONTROL, INDEPENDENT OF THE OTHER TWO.
 *
 * Tools and Features each have their own Hide button and their own collapsed
 * state; this is neither of them. Hiding the bars hides NOTHING else - the
 * two panels keep whatever state they were in - so "bars hidden, Tools
 * visible, Features visible" is a perfectly ordinary state, and so is its
 * opposite. Three controls, three independent states.
 *
 * HOW IT IS IMPLEMENTED, AND WHY IT IS NOT A WIDTH.
 *
 * Collapsing a side panel is a WIDTH change, because the panel sits in a grid
 * column. Collapsing these bars is a HEIGHT change: the two rows they occupy
 * are given up so the flexible canvas row takes them. The state is a single
 * class on `<body>` - `datum-topbar-hidden` - and the stylesheet redefines the
 * layout for it. One class, one place that decides what "hidden" means, and
 * the canvas's own row is unchanged (`minmax(0, 1fr)`), so it simply absorbs
 * the height that was freed.
 *
 * THE DRAWING IS NOT RE-FITTED, for the same reason collapsing a panel does
 * not re-zoom: the student's zoom and pan are theirs. A taller canvas shows
 * more of the drawing at the same scale, which is the whole point.
 *
 * THE STATE IS REMEMBERED FOR THE SESSION, not written to the document - it
 * is a property of how someone is working, not of the drawing they are
 * working on, so it does not belong in a saved file. It is held on the
 * running editor state, which survives ordinary redraws, tool changes and
 * resizes; only a page reload resets it.
 */
function setTopBarHidden(hidden) {
    document.body.classList.toggle(
        "datum-topbar-hidden",
        hidden
    );

    /*
     * THE TWO CONTROLS ARE ONE STATE. While the bar is shown, Hide is
     * present and Show is not; while it is hidden, the reverse. The Show
     * control is on the canvas, so it is reachable exactly when the bar it
     * restores is gone - which is the only time it is needed.
     */
    if (headerHideButton) {
        headerHideButton.setAttribute(
            "aria-expanded",
            hidden ? "false" : "true"
        );
    }

    if (drawingTopBarShow) {
        drawingTopBarShow.hidden = !hidden;
    }

    editorState.topBarHidden = hidden;

    /*
     * Redraw only. The zoom, the pan and the document are all untouched -
     * the canvas is simply taller, so more of the same drawing is visible.
     */
    renderCurrentDrawing();
}

/*
 * The zoom percentage FIELD accepts a typed value.
 *
 * It has always displayed the zoom, and it has always looked like an
 * input, so leaving it inert was misleading: a field that invites a
 * number and ignores it is worse than a plain label. The value goes
 * through the same updateDrawingZoom the buttons use, so it is clamped
 * and normalised identically and cannot produce a zoom the buttons
 * could not.
 *
 * The text is reset on blur as well as on Enter, because an entry that
 * is not accepted must not be left sitting in the field looking like
 * the current zoom.
 */
function applyTypedZoom() {
    const typed =
        Number(
            String(
                drawingZoomValue.value
            ).replace("%", "").trim()
        );

    if (!Number.isFinite(typed) || typed <= 0) {
        return;
    }

    updateDrawingZoom(typed);
}

/*
 * ========================================================
 * COLLAPSIBLE SIDE PANELS
 * ========================================================
 *
 * The tool panel and the Features panel can each be folded away,
 * so a student on a small screen can hand their horizontal space
 * to the drawing. The canvas is what the work is on; the panels
 * are navigation, and on a laptop they are the first thing worth
 * sacrificing.
 *
 * WHAT COLLAPSING DOES AND DOES NOT DO
 * ------------------------------------
 * It changes the LAYOUT and nothing else. The rail's width
 * changes, the grid's flexible canvas column takes up the
 * difference, and the drawing is re-rendered into a larger or
 * smaller viewport at exactly the zoom, pan and scale it already
 * had. Nothing here calls the zoom, and nothing here touches a
 * document value.
 *
 * That distinction is the whole reason this is not implemented as
 * a browser zoom or a CSS transform. A drawing that is 150% zoomed
 * stays 150%: it simply shows more of itself when a panel closes
 * and less when one opens. The viewport is measured from the
 * canvas element itself on every render, so this needs no
 * adjustment at all - only a redraw.
 *
 * A re-fit or a re-zoom here would be the obvious way to make the
 * canvas "fill" the new space, and it would be wrong: it would
 * move the student's drawing out from under them, change the zoom
 * they are working at, and make the panels feel like they had
 * changed the document.
 */
function setPanelCollapsed(
    toggle,
    rail,
    collapsed
) {
    if (!toggle || !rail) {
        return;
    }

    rail.classList.toggle(
        "drawing-panel-rail-collapsed",
        collapsed
    );

    /*
     * The grid TRACK is what actually reclaims the space.
     *
     * Narrowing the rail element alone would not do it: the rail
     * sits in a fixed 148px column, so a 22px element inside a
     * 148px track leaves the other 126px claimed by nothing. The
     * canvas column is the only flexible one, so the track has to
     * shrink for the drawing to grow.
     *
     * The workspace's own column template is therefore rewritten,
     * and it is written from the CURRENT state of both rails
     * rather than from this one toggle. A pair of independent
     * class toggles on two separate elements can disagree - one
     * collapsed while the other says otherwise - and the canvas
     * would then be laid out against a template describing a
     * state that does not exist.
     */
    syncWorkspaceColumns();

    /*
     * The arrow names the ACTION, not the state, and points the
     * way it will move. A control that describes where it is
     * rather than what it does is one more thing to work out, and
     * this one is a twenty-pixel strip.
     */
    toggle.setAttribute(
        "aria-expanded",
        collapsed
            ? "false"
            : "true"
    );

    const panelId =
        toggle.getAttribute(
            "aria-controls"
        );

    const panel = panelId
        ? document.getElementById(panelId)
        : null;

    if (panel) {
        panel.hidden = collapsed;
    }

    toggle.title = collapsed
        ? "Show panel"
        : "Hide panel";

    /*
     * The caption names the ACTION, not the state.
     *
     * When the panel is open the strip reads HIDE, because that is
     * what pressing it does. When the panel is closed the strip
     * takes the panel's own name - FEATURES or TOOLS - because at
     * that point the name is the only thing on the strip that
     * tells the student what pressing it will bring back.
     *
     * A control that labelled itself with the current state would
     * need the student to read it twice to work out which way it
     * goes; naming the action means the strip is legible on its
     * own, whether it is a twenty-pixel rail in the expanded
     * state or the only thing left of a collapsed panel.
     */
    const caption =
        toggle.querySelector(
            ".drawing-panel-toggle-text"
        );

    if (caption) {
        const panelName =
            panelId === "drawingFeaturesPanel"
                ? "FEATURES"
                : "TOOLS";

        caption.textContent = collapsed
            ? panelName
            : "HIDE";
    }

    toggle.querySelector("svg")?.setAttribute(
        "transform",
        collapsed
            ? collapsedArrowTransform(toggle)
            : "rotate(0)"
    );

    /*
     * Redraw only. The zoom, the pan and the document scale are
     * all deliberately left exactly as they are - see the note
     * above. A single render picks up the new canvas size.
     */
    renderCurrentDrawing();
}

function collapsedArrowTransform(
    toggle
) {
    return toggle.closest(
        ".drawing-panel-rail-right, .drawing-panel-rail-left"
    )
        ? "rotate(180)"
        : "rotate(0)";
}

/*
 * Re-derive the workspace's column template from the current
 * panel state.
 *
 * One place decides the layout, called after every change, so the
 * template and the two rails cannot fall out of step.
 */
function syncWorkspaceColumns() {
    const workspace =
        document.querySelector(
            ".drawing-workspace"
        );

    if (!workspace) {
        return;
    }

    const toolsCollapsed =
        document
            .querySelector(
                ".drawing-panel-rail-left"
            )
            ?.classList.contains(
                "drawing-panel-rail-collapsed"
            ) ?? false;

    const featuresCollapsed =
        document
            .querySelector(
                ".drawing-panel-rail-right"
            )
            ?.classList.contains(
                "drawing-panel-rail-collapsed"
            ) ?? false;

    workspace.classList.toggle(
        "drawing-workspace-tools-collapsed",
        toolsCollapsed
    );

    workspace.classList.toggle(
        "drawing-workspace-features-collapsed",
        featuresCollapsed
    );
}

/*
 * Wire this part of the editor to the page. Called once, at start-up,
 * by editor/index.js.
 */
export function installWorkspaceLayout() {
    if (
        drawingZoomValue
    ) {
        drawingZoomValue.addEventListener(
            "keydown",
            (event) => {
                if (event.key === "Enter") {
                    event.preventDefault();
                    applyTypedZoom();
                    drawingZoomValue.blur();

                    return;
                }

                if (event.key === "Escape") {
                    drawingZoomValue.value =
                        `${Math.round(editorState.drawingZoom)}%`;

                    drawingZoomValue.blur();
                }
            }
        );

        drawingZoomValue.addEventListener(
            "blur",
            () => {
                drawingZoomValue.value =
                    `${Math.round(editorState.drawingZoom)}%`;
            }
        );

        drawingZoomValue.addEventListener(
            "focus",
            () =>
                drawingZoomValue.select()
        );
    }

    if (
        drawingToolPanelToggle
    ) {
        const rail =
            drawingToolPanelToggle.closest(
                ".drawing-panel-rail"
            );

        drawingToolPanelToggle.addEventListener(
            "click",
            () =>
                setPanelCollapsed(
                    drawingToolPanelToggle,
                    rail,
                    !rail.classList.contains(
                        "drawing-panel-rail-collapsed"
                    )
                )
        );
    }

    if (
        drawingFeaturesPanelToggle
    ) {
        const rail =
            drawingFeaturesPanelToggle.closest(
                ".drawing-panel-rail"
            );

        drawingFeaturesPanelToggle.addEventListener(
            "click",
            () =>
                setPanelCollapsed(
                    drawingFeaturesPanelToggle,
                    rail,
                    !rail.classList.contains(
                        "drawing-panel-rail-collapsed"
                    )
                )
        );
    }

    if (
        drawingZoomIn
    ) {
        drawingZoomIn.addEventListener(
            "click",
            () =>
                updateDrawingZoom(
                    editorState.drawingZoom + 10
                )
        );
    }

    /*
     * THE TOP BAR'S TWO CONTROLS, WIRED TO THE ONE STATE.
     *
     * The Hide button is in the bar and collapses it; the Show button is on
     * the canvas and brings it back. Both call the same function, so there is
     * one definition of "hidden" and the two can never disagree about it.
     */
    headerHideButton?.addEventListener(
        "click",
        () => setTopBarHidden(true)
    );

    drawingTopBarShow?.addEventListener(
        "click",
        () => setTopBarHidden(false)
    );

    /*
     * THE SLIVER ITSELF IS THE WAY BACK.
     *
     * While the bars are hidden the rail is a 6px line across the top (see
     * `body.datum-topbar-hidden .drawing-top-rail`), and the whole line is the
     * control - the bars are `display: none`, so nothing else inside it can be
     * pressed.
     *
     * IT MUST NOT FIRE FOR A PRESS ON THE HIDE BUTTON ITSELF, and that is not a
     * detail - it was the whole of "Hide does nothing". The Hide button is a
     * CHILD of the rail, so its click bubbles up into this listener, and by the
     * time it arrives the class it just set is already on the body. The check
     * below then read that as "the sliver was pressed, bring the bars back" and
     * immediately undid the press: the bars flickered and stayed up.
     *
     * So a press that ORIGINATED inside the bars is ignored here - it belongs to
     * the control that was pressed. Only a press on the sliver itself, where
     * there is no bar to press, brings them back.
     */
    drawingTopRail?.addEventListener("click", (event) => {
        if (!document.body.classList.contains("datum-topbar-hidden")) {
            return;
        }

        /*
         * `headerHideButton` is the one control that is still on screen in the
         * hidden state's DOM (the bars are `display: none`, the button sits on
         * the rail), so it is named explicitly; anything inside a bar is already
         * unreachable and could not have produced this event.
         */
        if (headerHideButton && event.target.closest?.("#headerHideButton")) {
            return;
        }

        setTopBarHidden(false);
    });

    installTopRail(drawingTopRail);
}

/*
 * ========================================================
 * THE SHARED TOP RAIL: ONE SCROLLER FOR BOTH BARS
 * ========================================================
 *
 * The menu bar and the toolset bar live in ONE horizontally scrolling box (see
 * the markup and `.drawing-top-rail` in workspace-chrome.css), so they are
 * ALREADY synchronised: there is a single scroll offset, not two to keep in
 * step. Touchpad two-finger pans, `Shift`+wheel, horizontal wheels and the
 * scrollbar need no script at all.
 *
 * TWO SMALL THINGS ARE ADDED HERE.
 *
 * 1. SHIFT+WHEEL and plain vertical wheels pan the rail. A wheel with no
 *    horizontal axis - an ordinary mouse - sends only `deltaY`, and browsers
 *    disagree about whether Shift turns that into a sideways scroll. This makes
 *    that one gesture work everywhere, and only while the pointer is over the
 *    rail.
 * 2. ONE-FINGER HORIZONTAL SWIPE. Touch already scrolls an `overflow-x` box, so
 *    nothing is taken away here - a press that turns into a sideways drag pans
 *    the rail directly. A press that does not move is left alone, so the menu
 *    labels and toolset buttons keep their ordinary click.
 *
 * A TOOLSET BUTTON IS NEVER SCROLLED AWAY BY ACCIDENT. The drag only happens
 * after the finger has travelled further sideways than `TOUCH_SLOP_PX`, which is
 * the same threshold a browser uses before it treats a touch as a pan rather
 * than a tap.
 */
const TOUCH_SLOP_PX = 8;

function installTopRail(rail) {
    if (!rail) {
        return;
    }

    const scroller = rail.querySelector(".drawing-top-rail-scroll");

    if (!scroller) {
        return;
    }

    /*
     * CLIP ONLY WHEN THERE IS SOMETHING TO SCROLL.
     *
     * `overflow-x: auto` is a clip on both axes, and the menu panels drop from
     * the bar - under that clip they were cut off at the bar's edge and could
     * not be seen. So the rail is only made a scroll container while its
     * content is wider than it: a wide window (the usual case) shows its
     * dropdowns as ordinary children, and a compressed one scrolls and has the
     * panels placed against the window instead (see `menu-bar.js`).
     *
     * Checked on start-up and on every resize, because the width that matters
     * is the real one - panels collapsing, fonts landing and the window being
     * dragged all change it, and no media query can see all three.
     */
    const track = scroller.querySelector(".drawing-top-rail-track");

    const syncScrollState = () => {
        /* Measured unclipped, so the comparison is of real widths. */
        scroller.classList.remove("drawing-top-rail-scroll--scrollable");

        if (scroller.scrollWidth > scroller.clientWidth) {
            scroller.classList.add("drawing-top-rail-scroll--scrollable");
        }
    };

    let syncQueued = false;
    const queueSync = () => {
        if (syncQueued) {
            return;
        }

        syncQueued = true;
        globalThis.requestAnimationFrame(() => {
            syncQueued = false;
            syncScrollState();
            syncRowRule();
        });
    };

    /*
     * WHERE THE DIVIDER BETWEEN THE BARS GOES.
     *
     * The line between the menu-and-controls row and the section bar belongs to
     * the RAIL (see `.drawing-top-rail::after`), because the rail is the box
     * that does not scroll - the line therefore reaches both edges of the window
     * at every scroll position. Its distance from the bottom is `--rail-row-one`,
     * the HEIGHT OF THE FIRST ROW - measured here rather than guessed, because
     * the row is as tall as its tallest control and that changes with the font,
     * the theme and the window.
     *
     * It is written on the rail as well as on the track: the track keeps the
     * closing line under the section bar, the rail draws the divider above it.
     */
    const syncRowRule = () => {
        const row =
            (track || scroller).querySelector(".drawing-menu-controls-bar") ||
            scroller.firstElementChild?.firstElementChild;

        if (!row || !track) {
            return;
        }

        /*
         * A MEASUREMENT THAT DID NOT LAND IS NOT A MEASUREMENT.
         *
         * A row asked for its height before the page has laid it out answers
         * zero, and calling that the row's height would draw the rule through
         * the middle of the menu. So a zero falls back to the offset the row
         * itself reports - which is the same figure once layout has run - and
         * failing that the token's own default is left in place.
         */
        const measured = Math.round(row.getBoundingClientRect().height);
        const offset = Math.round(row.offsetHeight);
        const height = measured > 0 ? measured : offset;

        if (height > 0) {
            track.style.setProperty("--datum-rail-row-one", `${height}px`);

            /*
             * The rail's own line reads the same figure. It is set on the rail
             * because that is where the divider is painted, and inherited by
             * the track inside it, so the two can never disagree.
             */
            rail.style.setProperty("--datum-rail-row-one", `${height}px`);
        }
    };

    syncScrollState();
    syncRowRule();
    window.addEventListener("resize", queueSync, { passive: true });

    if (typeof globalThis.ResizeObserver === "function") {
        new globalThis.ResizeObserver(queueSync).observe(scroller.firstElementChild ?? scroller);
    }

    scroller.addEventListener(
        "wheel",
        (event) => {
            /* A deliberate horizontal gesture is the browser's to handle. */
            if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
                return;
            }

            if (!event.shiftKey || event.deltaY === 0) {
                return;
            }

            /* Nothing to pan: leave the wheel alone rather than swallow it. */
            if (scroller.scrollWidth <= scroller.clientWidth) {
                return;
            }

            scroller.scrollLeft += event.deltaY;
            event.preventDefault();
        },
        { passive: false },
    );

    let dragging = false;
    let startX = 0;
    let startLeft = 0;

    scroller.addEventListener(
        "touchstart",
        (event) => {
            if (event.touches.length !== 1) {
                dragging = false;

                return;
            }

            dragging = false;
            startX = event.touches[0].clientX;
            startLeft = scroller.scrollLeft;
        },
        { passive: true },
    );

    scroller.addEventListener(
        "touchmove",
        (event) => {
            if (event.touches.length !== 1) {
                return;
            }

            const dx = event.touches[0].clientX - startX;

            if (!dragging) {
                if (Math.abs(dx) < TOUCH_SLOP_PX) {
                    return;
                }

                dragging = true;
            }

            if (scroller.scrollWidth <= scroller.clientWidth) {
                return;
            }

            /*
             * Vertical movement is the page's and stays with it; a sideways
             * drag is this rail's.
             */
            scroller.scrollLeft = startLeft - dx;
            event.preventDefault();
        },
        { passive: false },
    );

    scroller.addEventListener(
        "touchend",
        () => {
            dragging = false;
        },
        { passive: true },
    );
}
