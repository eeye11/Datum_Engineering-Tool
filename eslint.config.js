import js from "@eslint/js";
import globals from "globals";

/*
 * Lint configuration.
 *
 * The rules that matter most here are the ones a classic-script codebase
 * could not have: an undefined name, an unused import, a binding declared
 * twice. Those are the defects the move to modules was meant to make
 * visible.
 */
export default [
    {
        ignores: ["dist/**", "node_modules/**", "tools/**", "tests/**"]
    },
    {
        files: ["src/**/*.js"],
        languageOptions: {
            /*
             * 2025, not 2022: import attributes (`with { type: "json" }`)
             * are ES2025 syntax, and the tool registry's manifest is a
             * module-load-time JSON import.
             */
            ecmaVersion: 2025,
            sourceType: "module",
            globals: {
                ...globals.browser,
                MathJax: "readonly"
            }
        },
        rules: {
            ...js.configs.recommended.rules,
            "no-unused-vars": ["warn", { args: "none", caughtErrors: "none" }],
            "no-empty": ["warn", { allowEmptyCatch: true }],
            "no-useless-escape": "off",
            "no-prototype-builtins": "off",
            "no-case-declarations": "off",
            "no-inner-declarations": "off",
            "no-useless-assignment": "warn"
        }
    },
    {
        files: ["server/**/*.js", "vite.config.js", "eslint.config.js"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "module",
            globals: globals.node
        },
        rules: js.configs.recommended.rules
    }
];
