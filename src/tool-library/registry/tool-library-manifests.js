/*
 * ============================================================
 * THE TOOL LIBRARY'S MANIFEST LOADER
 * ============================================================
 *
 * Resolves a registered tool to its implementation: its manifest, its LaTeX
 * template and its Features configuration.
 *
 * THE DIVISION OF RESPONSIBILITY, STATED ONCE.
 *
 *   registry/tool-registry.json   WHO a tool is and WHERE it sits: its id, its
 *                                 label, its category and hierarchy, and the
 *                                 library folder it lives in.
 *   <tool>/manifest.json          WHAT the tool is: identity restated locally,
 *                                 its template, and whether it is implemented.
 *   <tool>/template.tex           the LaTeX construction the tool uses.
 *   <tool>/features.json          the Features panel settings this tool offers,
 *                                 when it has any.
 *
 * The registry stays a pure hierarchy - it carries no LaTeX and no panel
 * configuration, so it can be read and rendered as a menu without loading a
 * single tool's implementation. The implementation lives with the tool, so a
 * tool can be finished or changed without touching the registry.
 *
 * NOTHING HERE INVENTED A TOOL. Every manifest, template and feature
 * declaration returned by this module comes from a file that already existed or
 * that a tool's own author wrote. A tool with no `features.json` has no feature
 * declaration, and that is reported as `null` rather than fabricated.
 */

import { allTools, tool as registryTool, libraryPathFor } from "./tool-registry.js";

/*
 * Vite resolves `?raw` imports to their text at build time. They are used here
 * rather than a runtime `fetch`, because the tool library ships WITH the
 * application: a tool's template is part of the bundle, not a file to be
 * requested when a tool is activated. A runtime fetch would also make every
 * tool load depend on the server being up, which is exactly what a static
 * deployment does not have.
 *
 * EACH GLOB IS GUARDED. `import.meta.glob` is a Vite compile-time transform;
 * it does not exist when the module is loaded outside the Vite pipeline - the
 * test suite, which loads these modules with Node's own loader. There the
 * call throws, the maps stay empty, and every query answers "nothing here"
 * - which is the same answer a tool with no folder gets, and is honest
 * rather than fatal. In the Vite build the calls resolve at compile time and
 * the try/catch is dead weight.
 */
let manifestModules = {};
let templateModules = {};
let featureModules = {};

try {
    manifestModules = import.meta.glob("../../tool-library/**/manifest.json", {
        eager: true,
        import: "default"
    });
} catch {
    /* No Vite transform: nothing is bundled. */
}

try {
    templateModules = import.meta.glob("../../tool-library/**/template.tex", {
        eager: true,
        query: "?raw",
        import: "default"
    });
} catch {
    /* No Vite transform: nothing is bundled. */
}

try {
    featureModules = import.meta.glob("../../tool-library/**/features.json", {
        eager: true,
        import: "default"
    });
} catch {
    /* No Vite transform: nothing is bundled. */
}

/*
 * `import.meta.glob` returns keys relative to this module. Normalise them to
 * the libraryPath the registry uses, so a tool can be looked up either way and
 * the two spellings cannot drift.
 */
function normaliseKey(key) {
    return String(key)
        .replace(/^\.\.\/\.\.\//, "")
        .replace(/^\/+/, "")
        .replace(/\\/g, "/");
}

function folderOf(key) {
    return normaliseKey(key).replace(/\/[^/]+$/, "");
}

const manifestsByFolder = new Map();
const templatesByFolder = new Map();
const featuresByFolder = new Map();

Object.entries(manifestModules).forEach(([key, value]) => {
    manifestsByFolder.set(folderOf(key), value);
});

Object.entries(templateModules).forEach(([key, value]) => {
    templatesByFolder.set(folderOf(key), value);
});

Object.entries(featureModules).forEach(([key, value]) => {
    featuresByFolder.set(folderOf(key), value);
});

function folderForTool(toolId) {
    const fromRegistry = libraryPathFor(toolId);

    if (fromRegistry) {
        return normaliseKey(fromRegistry);
    }

    const entry = registryTool(toolId);

    return entry && entry.libraryPath ? normaliseKey(entry.libraryPath) : null;
}

/*
 * A tool's manifest, or null when the tool is not in the registry or its folder
 * has no manifest. Null is a real answer: a registry entry with no folder is an
 * inconsistency to be reported, not one to be papered over with a default.
 */
export function manifestFor(toolId) {
    const folder = folderForTool(toolId);

    if (!folder) {
        return null;
    }

    return manifestsByFolder.get(folder) || null;
}

/*
 * A tool's LaTeX template. A reserved, empty template reads as the empty string
 * - it exists so a tool's folder has a stable shape, and returning the
 * placeholder's text would put a comment into the drawing source.
 */
export function templateFor(toolId) {
    const folder = folderForTool(toolId);

    if (!folder) {
        return null;
    }

    const text = templatesByFolder.get(folder);

    if (typeof text !== "string") {
        return null;
    }

    /*
     * The reserved placeholder is a comment explaining that the file is empty.
     * Treating it as a real template would write that comment into a student's
     * drawing. It reads as "no template yet", which is what it is.
     */
    if (/^\s*\/\*[\s\S]*?\*\/\s*$/.test(text) && text.trim().startsWith("/*")) {
        return null;
    }

    if (text.trim() === "") {
        return null;
    }

    return text;
}

/*
 * A tool's Features panel declaration, or null when it has none. The
 * declaration is data, not code: which settings are shown, their defaults,
 * their valid options, and which are construction options as opposed to
 * appearance defaults. The Features tab renders from this, so a tool's panel is
 * described in one place beside the tool rather than coded into the panel.
 */
export function featuresFor(toolId) {
    const folder = folderForTool(toolId);

    if (!folder) {
        return null;
    }

    return featuresByFolder.get(folder) || null;
}

/*
 * Everything about one tool's implementation, in one call. This is what a tool
 * activation, a source writer or a Features tab needs.
 */
export function toolImplementation(toolId) {
    const entry = registryTool(toolId);

    if (!entry) {
        return null;
    }

    const manifest = manifestFor(toolId);

    return {
        id: toolId,
        label: (manifest && manifest.label) || entry.label || toolId,
        category: (manifest && manifest.category) || entry.category || null,
        group: (manifest && manifest.group) || entry.group || null,
        parentId: entry.parentId || null,
        libraryPath: folderForTool(toolId),
        implemented: Boolean(manifest && manifest.implemented),
        template: templateFor(toolId),
        features: featuresFor(toolId)
    };
}

/*
 * Every tool in the registry whose source path resolves to a real folder. Used
 * by the registry's own consistency check, and by the Features tab to know
 * which tools can declare settings.
 */
export function implementationIndex() {
    const index = new Map();

    allTools().forEach((entry) => {
        index.set(entry.id, toolImplementation(entry.id));
    });

    return index;
}

export default {
    manifestFor,
    templateFor,
    featuresFor,
    toolImplementation,
    implementationIndex
};
