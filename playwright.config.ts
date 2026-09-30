import { defineConfig } from "@playwright/test";

/**
 * Playwright E2E tests for REST Control.
 *
 * These connect to the already-running CDP browser (`chromium.connectOverCDP`)
 * showing the code-server workbench, and assert the extension's HTTP contract,
 * its status-bar item, the QuickInput/notification UI its `custom.show*`
 * commands drive, and its outbound integrations. All arrange/act is done over
 * the REST Control API — see `tests/playwright/rest.ts` and
 * `docs/important/how-to-test-all.md` in the meta repo: "REST → arrange + act,
 * CDP → assert only".
 *
 * The tests do NOT launch a browser: point `CDP_PORT` at the running browser
 * (localhost:9024 by default, forwarded from pp). Topology and code-server
 * setup live in
 * `/home/lamnt45/git/vscode-hacker-meta/docs/important/dev-code-on-nuc-test-on-pp.md`.
 */
export default defineConfig({
  testDir: "./tests/playwright",
  // Keep run artifacts out of the repo root; `exp/` is gitignored.
  outputDir: "./exp/playwright",
  timeout: 90000,
  expect: { timeout: 15000 },
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
});
