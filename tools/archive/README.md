# Archive

Scripts kept for the record and **no longer maintained**. Nothing in the
application, the test suite or CI uses them. They were written against the
code as it was at the time, so some reach files that have since moved (the
editor and renderer were reorganised into folders); expect to fix paths
before running one.

| Folder     | What it is                                                                 |
| ---------- | -------------------------------------------------------------------------- |
| `qa/`      | Browser QA scenarios and probes from feature work on specific tools (`export default async function run(page)`), plus their screenshots. |
| `scratch/` | One-off diagnostic scripts that had accumulated in the repository root and in `tests/`. |

For checking the application today, use the maintained checks instead:

- `npm run check` — lint, unit and integration tests, build;
- `tests/e2e/golden-scenario.mjs` — every tool in Chrome, compared before and
  after a change with `tests/e2e/golden-compare.mjs` (see `docs/TESTING.md`);
- `tests/e2e/api-check.mjs` — the integration API in Chrome.
