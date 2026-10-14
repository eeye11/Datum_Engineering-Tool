/*
 * DAETUM - standalone application entry point.
 *
 * index.html loads this one module; everything else is reached through
 * imports. Most modules only define things, but a few wire themselves to
 * the page when they load (the toolbar, the sheet tabs, the drawing
 * controller, the written solution), so they are imported here in the same
 * order the page used to list its <script> tags. That keeps their start-up
 * side effects in the order the application was built and tested with.
 */
import "./app/tabs.js";
import "./editor/toolbar/tools.js";
import "./sheets/sheets.js";
import "./ui/ui.js";
import "./core/geometry/measurement-core.js";
import "./core/units/quantities.js";
import "./ui/feature-panel/property-panel.js";
import "./features/dimensions/dimension-model.js";
import "./features/dimensions/variable-dimension.js";
import "./features/annotations/annotation-model.js";
import "./features/dimensions/smart-dimension.js";
import "./core/model/drawing-state.js";
import "./file/document-file.js";
import "./file/file-save.js";
import "./file/recent-files.js";
import "./file/templates.js";
import "./file/document-export.js";
import "./file/document-recovery.js";
import "./core/scale/dimensions.js";
import "./core/scale/scale-calibration.js";
import "./core/geometry/feature-geometry.js";
import "./features/dimensions/creation-dimension.js";
import "./features/dimensions/creation-dimensioning.js";
import "./features/dimensions/dimension-editor.js";
import "./features/analysis/load-profile.js";
import "./core/selection/clipboard.js";
import "./features/analysis/rotational-arrow.js";
import "./core/geometry/body-frames.js";
import "./features/analysis/analysis-dependencies.js";
import "./features/analysis/diagram-equations.js";
import "./ui/editors/plot-editor.js";
import "./ui/editors/sketch-editor.js";
import "./core/geometry/feature-handles.js";
import "./rendering/renderer.js";
import "./core/snapping/object-snap.js";
import "./references/drawing-reference.js";
import "./sheets/sheet-tabs.js";
import "./editor/index.js";
import "./editor/toolbar/toolbar.js";
import "./solution/written-references.js";
import "./solution/writing-tab.js";
import { installAutomationHooks } from "./app/automation-hooks.js";
import enggErrorLog from "./app/error-log.js";
import { createDatumApi } from "./api/datum-api.js";
import { installEmbedBridge } from "./api/embed-bridge.js";
import { installMenuBar } from "./ui/menubar/menu-bar.js";
import { MENUS } from "./editor/toolbar/menu-commands.js";
import { installSavedTheme } from "./editor/workspace/theme.js";
import { installThemePreference } from "./editor/workspace/theme-preference.js";
import {
  installCommandSearch,
  installCommandSearchShortcut,
} from "./editor/toolbar/command-search.js";

/*
 * THE SAVED THEME, BEFORE ANYTHING IS DRAWN.
 *
 * Applied first so the very first frame is already in the right theme. Setting
 * the attribute rather than painting a colour is what makes it cheap enough to
 * do here: the palette lives in CSS, so this is one attribute write.
 *
 * `installThemePreference` is the same act PLUS the model's default drawing line
 * colour, which follows the theme - so the first feature drawn is already the
 * right colour. The attribute is set whether or not the editor state exists yet.
 */
installSavedTheme();
installThemePreference();

/*
 * THE MAIN MENU BAR.
 *
 * Mounted into the placeholder the workspace markup leaves for it, from the six
 * menu definitions. Every command it offers already existed - the bar is a new
 * door onto them, not a second implementation - so this is the whole of the
 * wiring: build the bar, and the commands are reachable.
 *
 * THE DEFINITIONS ARE PASSED AS FUNCTIONS, not as the objects they return. Each
 * menu's items move with the state - "Undo" greys out, "Hide Grid" becomes
 * "Show Grid" - so the bar evaluates them when a menu is opened rather than
 * once at start-up. Passing `MENUS.map((menu) => menu())` here would freeze
 * every label and every disabled state at whatever the application looked like
 * on load.
 */
installMenuBar(document.getElementById("datumMenuBar"), MENUS);

/*
 * THE COMMAND SEARCH, at the start of the quick-access toolbar.
 *
 * It reads the menu tree for its catalogue, so a command added to a menu is
 * findable the moment it is written.
 */
const commandSearchField = document.getElementById("drawingCommandSearch");

installCommandSearch(commandSearchField);
installCommandSearchShortcut(commandSearchField);

/*
 * Record failures from the places the application cannot catch: an error thrown
 * inside an event listener, or a promise nobody awaited. Installed BEFORE
 * anything else, so a failure during start-up is recorded rather than lost.
 */
enggErrorLog.installGlobalErrorHandlers();

installAutomationHooks();

/*
 * The integration API (docs/INTEGRATION.md): window.datum for scripts in
 * this page, and the postMessage bridge for a page that embeds DAETUM
 * (active only when the embedding origin is named in the URL).
 */
const datum = createDatumApi();

window.datum = datum;
installEmbedBridge(datum);
