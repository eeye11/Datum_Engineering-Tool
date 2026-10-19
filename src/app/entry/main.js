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
import "../../components/layout/navigation/tabs.js";
import "../../components/layout/toolbar/tools.js";
import "../../components/layout/workspace/sheets.js";
import "../../shared/ui/ui.js";
import "../../shared/geometry/measurement-core.js";
import "../../shared/units/quantities.js";
import "../../components/layout/panels/property-panel.js";
import "../../features/workspace/model/dimensions/dimension-model.js";
import "../../features/workspace/model/annotations/annotation-model.js";
import "../../shared/model/drawing-state.js";
import "../../shared/file/document-file.js";
import "../../shared/file/file-save.js";
import "../../shared/file/recent-files.js";
import "../../shared/file/templates.js";
import "../../shared/file/document-export.js";
import "../../shared/file/document-recovery.js";
import "../../shared/scale/dimensions.js";
import "../../shared/geometry/feature-geometry.js";
import "../../features/workspace/model/dimensions/creation-dimension.js";
import "../../features/workspace/model/dimensions/creation-dimensioning.js";
import "../../features/workspace/model/analysis/load-profile.js";
import "../../shared/selection/clipboard.js";
import "../../features/workspace/model/analysis/rotational-arrow.js";
import "../../shared/geometry/body-frames.js";
import "../../features/workspace/model/analysis/analysis-dependencies.js";
import "../../features/workspace/model/analysis/diagram-equations.js";
import "../../shared/ui/editors/plot-editor.js";
import "../../shared/ui/editors/sketch-editor.js";
import "../../shared/geometry/feature-handles.js";
import "../../shared/rendering/renderer.js";
import "../../shared/snapping/object-snap.js";
import "../../shared/references/drawing-reference.js";
import "../../components/layout/workspace/sheet-tabs.js";
import "../../features/workspace/index.js";
import "../../components/layout/toolbar/toolbar.js";
import "../../shared/solution/written-references.js";
import "../../shared/solution/writing-tab.js";
import { installAutomationHooks } from "../automation-hooks.js";
import enggErrorLog from "../error-log.js";
import { createDatumApi } from "../../shared/integration/datum-api.js";
import { installEmbedBridge } from "../../shared/integration/embed-bridge.js";
import { installMenuBar } from "../../components/layout/menu-bar/menu-bar.js";
import { MENUS } from "../../components/layout/menu-bar/menu-commands.js";
import { installSavedTheme } from "../../components/layout/workspace/theme.js";
import { installThemePreference } from "../../components/layout/workspace/theme-preference.js";
import {
  installCommandSearch,
  installCommandSearchShortcut,
} from "../../components/layout/toolbar/command-search.js";

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

globalThis.__enggMainRan = "body reached";

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
installMenuBar(globalThis.document.getElementById("datumMenuBar"), MENUS);

/*
 * THE COMMAND SEARCH, at the start of the quick-access toolbar.
 *
 * It reads the menu tree for its catalogue, so a command added to a menu is
 * findable the moment it is written.
 */
const commandSearchField = globalThis.document.getElementById("drawingCommandSearch");

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
