/*
 * ============================================================
 * THE SIX MENUS, AND WHAT EACH COMMAND ACTUALLY CALLS
 * ============================================================
 *
 * This file is the COMMAND MAP: every menu item, and the existing operation it
 * invokes. It contains no behaviour of its own - a menu item whose `run` did
 * real work would be a second implementation of something the application
 * already has, which is the one thing the interface work was told not to do.
 *
 * Each command is therefore one of:
 *
 *   RELOCATED   the operation already existed and is called unchanged. Save,
 *               Undo, Cut, Fit and the display toggles are all of these - the
 *               menu is a new door onto the same room.
 *
 *   SHARED      the operation exists but was only reachable from a toolbar
 *               control. The menu item and the toolbar control call the SAME
 *               function on the SAME state, so the two cannot disagree.
 *
 *   NEW         nothing existed, and the command is built in its own module
 *               rather than here. This file only names it.
 *
 * WHY THE ITEMS ARE BUILT FRESH EVERY TIME A MENU OPENS
 * ----------------------------------------------------
 * Because their state moves. "Undo" is greyed out until there is something to
 * undo; "Show Grid" is ticked while the grid is up. A menu built once at
 * start-up would show the state the application had on load, for the rest of
 * the session. So `items()` is a FUNCTION for each menu, evaluated on open.
 */

import { performRedo, performUndo } from "../toolbar/tool-activation.js";
import {
    copySelectionToClipboard,
    cutSelectionToClipboard,
    pasteFromClipboard
} from "../../../features/workspace/commands/clipboard-commands.js";
import { deleteSelectedObjects } from "../../../features/workspace/commands/delete-command.js";
import { FILE_ACTIONS } from "../../../features/workspace/commands/document-commands.js";
import { openLatexCodeEditor } from "../../../features/workspace/commands/latex-commands.js";
import { formatDrawingSource } from "../../../features/workspace/commands/source-commands.js";
import { fitDrawingToView } from "../workspace/viewport.js";
import { drawingState } from "../../../features/workspace/editor-state.js";
import { activateTool } from "../toolbar/tool-activation.js";
import {
    activateGlobalTool,
    applyDrawOrderToSelection,
    openCategoryAndArmTool,
    selectAllObjects,
    showHelp,
    showSettings,
    toggleDisplaySetting,
    toggleWorkspaceSettingById,
    zoomByFactor
} from "./menu-commands-actions.js";
import enggDrawingState from "../../../shared/model/drawing-state.js";

/*
 * THE SHORTCUT LABELS.
 *
 * Written down once so a menu and the keyboard module cannot describe the same
 * key differently. These are LABELS - the keys themselves are bound in
 * `keyboard-shortcuts.js`, and this file deliberately does not bind them again.
 */
const KEYS = {
    new: "Ctrl+N",
    save: "Ctrl+S",
    saveAs: "Ctrl+Shift+S",
    print: "Ctrl+Shift+P",
    undo: "Ctrl+Z",
    redo: "Ctrl+Y",
    copy: "Ctrl+C",
    cut: "Ctrl+X",
    paste: "Ctrl+V",
    all: "Ctrl+A",
    fit: "Ctrl+0",
    delete: "Del",
    formatSource: "Ctrl+Shift+F"
};

/*
 * Whether there is anything to undo or redo.
 *
 * Asked of the history system rather than tracked here, so the greyed-out menu
 * item and the toolbar's disabled button are the same fact.
 */
const canUndo = () => enggDrawingState.canUndo(drawingState);

const canRedo = () => enggDrawingState.canRedo(drawingState);

const hasSelection = () =>
    (drawingState.selection?.selectedObjectIds || []).length > 0;

/*
 * Whether anything on the sheet can be selected at all, so "Select All" is not
 * offered on a blank drawing.
 */
const hasObjects = () => (drawingState.objects || []).length > 0;

/*
 * THE GRID'S VISIBILITY.
 *
 * IT IS NOT ON `state.display`.
 *
 * The grid is drawn on the CANVAS, so its visibility lives with the other
 * canvas switches on `state.grid.visible` and `state.snap.enabled` - not with
 * the annotation display settings on `state.display`. Reading the wrong one is
 * what made this menu item's label never change: the toolbar wrote
 * `grid.visible`, the menu asked `display.showGrid`, and the two were never the
 * same fact.
 *
 * `gridVisible()` is the one reader, used by the label and by the item's title,
 * so the wording and the state cannot drift apart again.
 */
const gridVisible = () => drawingState.grid?.visible !== false;

const display = () => drawingState.display || {};

/*
 * ============================================================
 * FILE
 * ============================================================
 *
 * Every one of these already existed and is reached through the application's
 * own `FILE_ACTIONS`, so the unsaved-changes guard, the file format, the crash
 * recovery and the print path are the ones the application was built with. The
 * menu adds a door; it does not add a way of saving.
 */
const fileMenu = () => ({
    id: "file",
    label: "File",
    items: [
        /* Create and open. */
        { id: "new", label: "New", icon: "file-plus", shortcut: KEYS.new, run: FILE_ACTIONS.new },
        { id: "open", label: "Open", icon: "folder-open", run: FILE_ACTIONS.open },

        { separator: true },

        /* Save. */
        { id: "save", label: "Save", icon: "save", shortcut: KEYS.save, run: FILE_ACTIONS.save },
        { id: "save-as", label: "Save As", icon: "file-pen", shortcut: KEYS.saveAs, run: FILE_ACTIONS["save-as"] },

        { separator: true },

        /*
         * THE DOCUMENT AND WHERE IT IS KEPT.
         *
         * Rename changes the document's name; Share offers the two ways this
         * application can really pass a drawing on; Download takes a copy; and
         * Details reads back what is recorded. They sit together because they
         * are all about the FILE rather than about what is drawn on it.
         */
        { id: "rename", label: "Rename", icon: "pencil", run: FILE_ACTIONS.rename },
        { id: "share", label: "Share", icon: "share-2", run: FILE_ACTIONS.share },

        /*
         * DOWNLOAD IS A SUBMENU, NOT A COMMAND.
         *
         * It used to download one fixed format. It now offers the four the
         * application really supports, so the row opens a nested list rather
         * than acting - which is what the chevron on its right says. Each child
         * is a real export of the document as it stands, including unsaved
         * changes, and each is the same format the corresponding Save As or
         * Print route produces.
         *
         * THE DRAWING ENTRY IS WHAT SAVE WRITES: the .tex with the editable
         * document embedded. "LaTeX picture" is the picture alone, for pasting
         * into another document.
         */
        {
            id: "download",
            label: "Download",
            icon: "download",
            submenu: [
                {
                    id: "download-pdf",
                    label: "PDF",
                    icon: "file-text",
                    run: () => FILE_ACTIONS.download("pdf")
                },
                {
                    id: "download-jpg",
                    label: "JPG",
                    icon: "image",
                    run: () => FILE_ACTIONS.download("jpg")
                },
                {
                    id: "download-png",
                    label: "PNG",
                    icon: "image",
                    run: () => FILE_ACTIONS.download("png")
                },
                {
                    id: "download-drawing",
                    label: "Drawing (.tex, editable)",
                    icon: "file-pen",
                    run: () => FILE_ACTIONS.download("drawing")
                },
                {
                    id: "download-latex",
                    label: "LaTeX picture (.tex)",
                    icon: "file-pen",
                    run: () => FILE_ACTIONS.download("latex")
                },
                {
                    id: "download-solution",
                    label: "Written Solution (.tex, drawings embedded)",
                    icon: "file-pen",
                    run: () => FILE_ACTIONS.download("solution")
                }
            ]
        },

        { id: "details", label: "Details", icon: "info", run: FILE_ACTIONS.details },

        { separator: true },

        /* Print. */
        { id: "print", label: "Print", icon: "printer", shortcut: KEYS.print, run: FILE_ACTIONS.print },

        { separator: true },

        /*
         * THE DESTRUCTIVE ACTION, LAST AND ALONE.
         *
         * It sits below a divider, at the bottom of the menu, because that is
         * where a command that cannot be undone by pressing Back belongs - away
         * from the routine ones, so it is never reached by a slip of the
         * pointer. Its icon is the trash can, and the confirmation it opens is
         * where the warning treatment lives; a permanently red menu row would be
         * decoration rather than a warning.
         */
        {
            id: "move-to-trash",
            label: "Move to Trash",
            icon: "trash-2",
            run: FILE_ACTIONS["move-to-trash"]
        }
    ]
});

/*
 * ============================================================
 * EDIT
 * ============================================================
 *
 * Undo, redo and the clipboard are the application's own commands. The menu
 * does not keep a second history or a second clipboard: it calls the same
 * functions the toolbar and the keyboard already call.
 *
 * THE DISABLED STATES ARE READ NOW, not remembered, which is what makes
 * "Undo" grey out the moment the history empties.
 */
const editMenu = () => ({
    id: "edit",
    label: "Edit",
    items: [
        {
            id: "undo",
            label: "Undo",
            icon: "undo-2",
            shortcut: KEYS.undo,
            disabled: !canUndo(),
            disabledReason: "There is nothing to undo",
            run: performUndo
        },
        {
            id: "redo",
            label: "Redo",
            icon: "redo-2",
            shortcut: KEYS.redo,
            disabled: !canRedo(),
            disabledReason: "There is nothing to redo",
            run: performRedo
        },
        { separator: true },
        {
            id: "cut",
            label: "Cut",
            icon: "scissors",
            shortcut: KEYS.cut,
            disabled: !hasSelection(),
            disabledReason: "Select something to cut first",
            run: cutSelectionToClipboard
        },
        {
            id: "copy",
            label: "Copy",
            icon: "copy",
            shortcut: KEYS.copy,
            disabled: !hasSelection(),
            disabledReason: "Select something to copy first",
            run: copySelectionToClipboard
        },
        {
            id: "paste",
            label: "Paste",
            icon: "clipboard-paste",
            shortcut: KEYS.paste,
            /*
             * ALWAYS OFFERED, AND HONEST WHEN THERE IS NOTHING TO PASTE.
             *
             * The clipboard belongs to the session, not the document, and the
             * paste command already reports "nothing to paste" truthfully when
             * it is empty. Greying the item out would need this file to know a
             * fact the command already knows - and a second copy of a fact is
             * a second thing to keep true.
             */
            run: pasteFromClipboard
        },
        { separator: true },
        {
            id: "select-all",
            label: "Select All",
            icon: "selection",
            shortcut: KEYS.all,
            disabled: !hasObjects(),
            disabledReason: "There is nothing on this sheet to select",
            run: selectAllObjects
        },
        {
            id: "delete",
            label: "Delete",
            icon: "trash-2",
            shortcut: KEYS.delete,
            disabled: !hasSelection(),
            disabledReason: "Select something to delete first",
            run: deleteSelectedObjects
        }
    ]
});

/*
 * ============================================================
 * VIEW
 * ============================================================
 *
 * Pan, Zoom and Fit are the existing viewport commands. The three visibility
 * items call the SAME toggle the toolbar button calls, so the menu tick and the
 * toolbar's highlight are one setting with two readings - never two settings.
 */
const viewMenu = () => ({
    id: "view",
    label: "View",
    items: [
        {
            id: "pan",
            label: "Pan",
            icon: "hand",
            run: () => activateTool("pan")
        },
        {
            id: "zoom-in",
            label: "Zoom In",
            icon: "zoom-in",
            run: () => stepZoom(1.25)
        },
        {
            id: "zoom-out",
            label: "Zoom Out",
            icon: "zoom-out",
            run: () => stepZoom(0.8)
        },
        {
            id: "fit",
            label: "Fit to Screen",
            icon: "maximize-2",
            shortcut: KEYS.fit,
            run: fitDrawingToView
        },
        { separator: true },
        /*
         * THE THREE VISIBILITY SWITCHES.
         *
         * THE LABEL CARRIES THE STATE, and there is no tick beside it.
         *
         * A tick AND a verb were saying the same thing twice - "Hide Grid"
         * with a checkmark in front of it means "the grid is on, and pressing
         * this hides it", which the two words already say. The label is the
         * whole statement: each command is named for what it WILL DO, so it
         * reads "Hide Grid" while the grid is up and "Show Grid" while it is
         * down - the same way every other command in this menu reads.
         */
        {
            id: "grid",
            label: gridVisible() ? "Hide Grid" : "Show Grid",
            icon: "grid",
            run: () => toggleWorkspaceSettingById("drawingGridToggle")
        },
        {
            id: "dimensions",
            label:
                display().showDimensions === false
                    ? "Show Dimensions"
                    : "Hide Dimensions",
            icon: "ruler",
            run: () =>
                toggleDisplaySetting("showDimensions", "drawingDimensionsToggle")
        },
        {
            id: "magnitudes",
            label:
                display().showMagnitudes === false
                    ? "Show Magnitudes"
                    : "Hide Magnitudes",
            icon: "arrow-up-right",
            run: () =>
                toggleDisplaySetting("showMagnitudes", "drawingMagnitudesToggle")
        }
    ]
});

/*
 * ============================================================
 * INSERT
 * ============================================================
 *
 * Table, Text Box and Drawing/Diagram are ANNOTATE and REFERENCE features that
 * already exist. The menu does not build a second version of any of them: it
 * opens the category they live in and arms the tool, so the student lands in the
 * state a toolbar click would have produced.
 *
 * `openCategoryAndArmTool` drives the real category button, so the tool reset,
 * the preview clearing and the tool-list re-render are the application's own.
 *
 * IMAGE AND DRAWING ARE NOT HERE YET, and that is stated rather than faked - see
 * the note on each. An item that opened an empty dialog would be worse than an
 * item that is honestly absent.
 */
const insertMenu = () => ({
    id: "insert",
    label: "Insert",
    items: [
        {
            id: "table",
            label: "Table",
            icon: "table",
            run: () => openCategoryAndArmTool("ANNOTATE", "table")
        },
        { separator: true },
        {
            id: "text-box",
            label: "Text Box",
            icon: "text-cursor",
            run: () => openCategoryAndArmTool("ANNOTATE", "note")
        },
        { separator: true },
        {
            id: "drawing",
            label: "Drawing / Diagram",
            icon: "shapes",
            run: () => openCategoryAndArmTool("STATICS", "body")
        },
        { separator: true },
        {
            id: "latex-code",
            label: "LaTeX Code…",
            icon: "file-text",
            run: () => openLatexCodeEditor()
        }
    ]
});

/*
 * ============================================================
 * HELP
 * ============================================================
 *
 * The guide and the help are honest about being brief. About reads the real
 * version from the document's metadata rather than inventing one - a made-up
 * version number is worse than none, because it is the first thing somebody
 * quotes when reporting a problem.
 *
 * KEYBOARD SHORTCUTS IS DELIBERATELY NOT HERE: it belongs to Tools, where the
 * rest of the reference material lives, and listing it in two menus would be the
 * duplication the rest of this work has been removing.
 */
const helpMenu = () => ({
    id: "help",
    label: "Help",
    items: [
        {
            id: "user-guide",
            label: "User Guide",
            icon: "book-open",
            run: () => showHelp("guide")
        },
        {
            id: "drawing-help",
            label: "Drawing Help",
            icon: "drafting-compass",
            run: () => showHelp("drawing")
        },
        {
            id: "feedback",
            label: "Report a Problem / Feedback",
            icon: "message-square-warning",
            run: () => showHelp("feedback")
        },
        { separator: true },
        {
            id: "about",
            label: "About DAETUM",
            icon: "info",
            run: () => showHelp("about")
        }
    ]
});

/*
 * ============================================================
 * TOOLS
 * ============================================================
 *
 * Four groups, as the specification asks: Drawing Settings, Precision &
 * Snapping, Measurement & Inspection, and Keyboard Shortcuts.
 *
 * THIS IS WHERE THE MODIFY TOOLS LIVE NOW. Move, Rotate, Mirror, Trim, Extend
 * and the draw-order commands used to be buttons on the global tool bar. When
 * that bar was removed - it duplicated the menu bar and made the top of the
 * window carry two rows of the same words - these were the commands with no
 * menu home, so they get one here rather than being lost.
 *
 * They are the SAME commands: each item calls the button's own action, so the
 * tool that arms is the tool the button used to arm.
 */
const toolsMenu = () => ({
    id: "tools",
    label: "Tools",
    items: [
        { id: "drawing-settings", label: "Drawing Settings\u2026", icon: "settings-2", run: () => showSettings("drawing") },
        { id: "precision", label: "Precision & Snapping\u2026", icon: "crosshair", run: () => showSettings("snapping") },
        {
            id: "measure-distance",
            label: "Measure Distance\u2026",
            icon: "ruler",
            run: () => showSettings("measure-distance")
        },
        {
            id: "measure-angle",
            label: "Measure Angle\u2026",
            icon: "protractor",
            run: () => showSettings("measure-angle")
        },
        {
            id: "inspect",
            label: "Inspect Selected Feature",
            icon: "scan-search",
            disabled: !hasSelection(),
            disabledReason: "Select a feature to inspect first",
            run: () => showSettings("inspect")
        },
        { id: "shortcuts", label: "Keyboard Shortcuts\u2026", icon: "keyboard", run: () => showSettings("shortcuts") },

        { separator: true },

        /*
         * FORMAT SOURCE.
         *
         * The one source-specific command. It is here - with the application's
         * other tools - rather than as a button in the Source tab, because that
         * is where every other command the student can run lives, and a tab with
         * its own toolbar would be a second interface inside the panel.
         */
        {
            id: "format-source",
            label: "Format Source",
            icon: "align-left",
            shortcut: KEYS.formatSource,
            run: formatDrawingSource
        },

        { separator: true },

        /*
         * THE MODIFY TOOLS, RELOCATED FROM THE OLD TOOL BAR.
         *
         * Each arms the same tool its button armed. Trim is among them, and it
         * is the one tool in this task that needed repairing - it is listed here
         * unchanged so the repair is about the tool's behaviour, not about where
         * it is reached from.
         */
        { id: "move", label: "Move", icon: "hand", shortcut: "M", run: () => activateGlobalTool("move") },
        { id: "rotate", label: "Rotate", icon: "snap-inference", run: () => activateGlobalTool("rotate") },
        { id: "mirror", label: "Mirror", icon: "shapes", run: () => activateGlobalTool("mirror") },
        { id: "trim", label: "Trim", icon: "scissors", run: () => activateGlobalTool("trim") },
        { id: "extend", label: "Extend", icon: "arrow-up-right", run: () => activateGlobalTool("extend") },

        { separator: true },

        /* Draw order: what is drawn on top of what. Purely presentational. */
        {
            id: "order-front",
            label: "Bring to Front",
            icon: "maximize-2",
            disabled: !hasSelection(),
            run: () => applyDrawOrderToSelection("front")
        },
        {
            id: "order-forward",
            label: "Bring Forward",
            icon: "arrow-up-right",
            disabled: !hasSelection(),
            run: () => applyDrawOrderToSelection("forward")
        },
        {
            id: "order-backward",
            label: "Send Backward",
            icon: "arrow-up-right",
            disabled: !hasSelection(),
            run: () => applyDrawOrderToSelection("backward")
        },
        {
            id: "order-back",
            label: "Send to Back",
            icon: "maximize-2",
            disabled: !hasSelection(),
            run: () => applyDrawOrderToSelection("back")
        }
    ]
});

/*
 * Zoom, in steps, through the viewport's OWN zoom command.
 *
 * The menu does not do the arithmetic or the redraw: `zoomByFactor` anchors on
 * the canvas centre and hands the value to the same `zoomAtCanvasPoint` the
 * wheel uses, so the limits are shared and a menu zoom cannot exceed them.
 */
function stepZoom(factor) {
    zoomByFactor(factor);
}

export const MENUS = [
    fileMenu,
    editMenu,
    insertMenu,
    viewMenu,
    toolsMenu,
    helpMenu
];
