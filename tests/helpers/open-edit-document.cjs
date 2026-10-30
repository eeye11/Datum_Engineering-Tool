﻿/*
 * ============================================================
 * THE APPLICATION'S MODULES, BOUND BEFORE THE PAGE IS BOOTED
 * ============================================================
 *
 * A test of the Open / Save round trip needs two things at once:
 *
 *   the LIVE document   the model, the sheets and the source manager of the
 *                       page - because the pipeline's listeners (the panel's
 *                       object-to-source sync, the tab's) are wired into it;
 *   the REAL functions  `loadDrawing`, the writer, the reader, the decoder.
 *
 * Only a page that has actually booted has the first. Only modules loaded while
 * `require` is still NODE'S OWN have the second: `bootApp()` runs the page
 * behind a `require` that answers an application path with the module's SOURCE
 * TEXT, which is how it executes the entry point once (`boot-app.cjs`). Load a
 * module after that and the "exported function" is a character of a comment.
 *
 * Modules are singletons, so the modules loaded here are the very instances the
 * booted page goes on to use - and the listeners installed by the boot end up
 * attached to the same objects these handles refer to.
 *
 * WHY A HELPER, AND NOT PATHS IN THE TEST. The page's `require` is selected by
 * inspecting the CALLER'S SOURCE TEXT for a module path. A test file that names
 * one anywhere is answered with source text even for a call made before the
 * boot. Keeping the paths in this file keeps them out of the test's own text.
 */

const path = require("path");

/*
 * THE HELPER'S OWN FILES, BY A PATH BUILT AT RUN TIME.
 *
 * The boot (see below) picks a module for ANY `require` by matching the caller's
 * TEXT against known filenames, and this helper names several of them further
 * down. A literal path here would be matched against those - the lookup took
 * "source-path.cjs" for the module file named `source-path.js`. A path assembled
 * at run time is not in the text, so it is answered by Node itself.
 */
const at = (...parts) => require(path.join(__dirname, ...parts));

const boot = at("boot" + "-app.cjs");
const { bootApp, whenReady, projectRoot } = boot;
const sourcePaths = at("source" + "-path.cjs");

let bound = null;

/*
 * THE LOCATOR, BOUND AT LOAD TIME.
 *
 * It must NOT be required inside`loadEditableDocument`: that function also names
 * the module files the caller is asking for, and a `require` of the helper from
 * within it was answered with the SOURCE TEXT of whichever module the page's
 * lookup happened to pick (`source-path.cjs` matching a file the text mentions).
 * Bound here - before the page exists - it is simply the real function.
 */
const locator = sourcePaths.locate;

/* A module's absolute path, built at run time. */
const moduleFile = (pathUnderSource) => locator(pathUnderSource);

/*
 * ONE MODULE PER FUNCTION, EACH NAMING ITS OWN FILE - AND NAMING IT BY PATH.
 *
 * The page chooses a module for `require` by reading the CALLER's source text and
 * taking the first filename it recognises there, so a function that names
 * several files is answered with one of them for every request it makes. Each
 * module therefore has a function of its own.
 *
 * AND IT IS LOADED BY FULL PATH, NOT BY FILE NAME. The name-based lookup cannot
 * tell one `document-commands.js` from another in the tree; a path can.
 */
function workspaceCommands() {
    return require(moduleFile("features/workspace/commands/document-commands.js"));
}

function modelState() {
    return require(moduleFile("shared/model/drawing-state.js"));
}

function editorStateModule() {
    return require(moduleFile("features/workspace/editor-state.js"));
}

function documentFormat() {
    return require(moduleFile("shared/file/document-file.js"));
}

function latexDocument() {
    return require(moduleFile("shared/file/latex/latex-document.js"));
}

function latexReader() {
    return require(moduleFile("shared/file/latex/latex-reader.js"));
}

/* The panel the round trip's listeners live in - loaded once, by its full path. */
function installPanels() {
    return require(moduleFile("components/layout/panels/drawing-panel.js"));
}

function installSourceEditor() {
    return require(moduleFile("components/layout/panels/source-tab.js"));
}

/*
 * Load the page and the modules, once per process.
 *
 * The page is booted FIRST, so the modules are published on the globals the page
 * itself uses (see `loadModule`), and the modules are loaded immediately after -
 * still before `bootApp()` returns to the caller's require hook - so they are
 * the real exports.
 */
function loadEditableDocument() {
    if (bound) {
        return bound;
    }

    const page = bootApp();

    const modules = {
        commands: workspaceCommands(),
        drawing: modelState(),
        editor: editorStateModule(),
        format: documentFormat(),
        latex: latexDocument(),
        reader: latexReader(),
    };

    /*
     * THE LISTENERS, INSTALLED AS THE APPLICATION INSTALLS THEM.
     *
     * The boot runs the entry point, which installs the toolbar and the menu; the
     * drawing inspector and the source tab are installed by the workspace when
     * the drawing tab opens. A test that loads a document without them would be
     * testing a page that cannot reproduce the round trip at all.
     */
    installPanels().installDrawingPanel();
    installSourceEditor().installSourceTab();
    void locator;

    for (const [name, exported] of Object.entries(modules)) {
        if (!exported || typeof exported === "string") {
            throw new Error(
                `The ${name} module was not loaded as code. Check that this helper is ` +
                    `called before any other application module is required (${projectRoot}).`
            );
        }
    }

    /*
     * THE COMMANDS MODULE MUST BE THE WORKSPACE'S OWN.
     *
     * The toolbar has a theme module that is also called "theme", and the boot's
     * file-name lookup has more than one candidate to choose from in this tree.
     * `loadDrawing` is the function the round trip is about, so its presence is
     * the check that the right file was loaded - and if it is missing the error
     * says so at once rather than three tests later.
     */
    for (const required of ["loadDrawing", "serializeDocumentBody", "decodeFileText"]) {
        if (typeof modules.commands[required] !== "function") {
            throw new Error(`The commands module has no ${required} - the wrong module was loaded.`);
        }
    }

    bound = {
        page,
        modules,
        /* `modules.commands` IS the module here - its functions are its own names. */
        decoder: modules.commands.decodeFileText,
        ready: whenReady(),
        projectRoot,
    };

    return bound;
}

module.exports = {
    loadEditableDocument,
    bootApp,
    whenReady,
    projectRoot,
    path,
};
