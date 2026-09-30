# REST Control: committed Playwright E2E suite (the control channel tests itself)

**Date:** 2026-09-30
**Status:** DONE — `make typecheck-tests` clean, `@playwright/test` files
Prettier-clean, `make test-e2e` → **20 passed** (~10 s) against code-server + CDP
9024, run three times back-to-back.
**Scope:** `tests/playwright/*` (new), `tests/playwright/workspace/*` (new),
`playwright.config.ts` (new), `tsconfig.tests.json` (new), `tsconfig.json`,
`package.json`, `package-lock.json`, `Makefile`, `.gitignore`, `.vscodeignore`,
`README.md`, `docs/important/how-to-test.md` (new), and the meta repo's
`docs/important/how-to-test-all.md` reference map.

---

## 0. Session summary

`vscode-hacker-rest-control` was the **only** extension in the meta repo with no
committed Playwright E2E layer — it still shipped only the legacy
`@vscode/test-electron` + Mocha scaffold under `src/test/suite/`. Every
counterpart (`hacker-browser`, `hacker-path-picker`, `hacker-stats-bar`,
`hacker-terminal-enhanced`) had `tests/playwright/`, a `playwright.config.ts`,
`tsconfig.tests.json`, `make test-e2e` / `make typecheck-tests`, and a
`docs/important/how-to-test.md`.

The twist: REST Control **is** the control channel every other suite drives
through. So its own suite both *uses* the channel and *asserts* it.

| Phase | Delivered |
| --- | --- |
| **Probe** | Live probes pinned the status-bar text, the falsy-boxing rule, the `400` error shape, the query-string form, and the loopback-only bind before any test was written |
| **E2E core** | `tests/playwright/rest.ts` (+ `restResponse`), `workbench.ts`, `fixtures.ts`, `rest-control.spec.ts`, `playwright.config.ts`, `tsconfig.tests.json`, npm/Make targets |
| **Oracle** | Branded `RC Port: <n>` status item; a local loopback HTTP fixture server as the ground truth for the two **outbound** integrations |
| **Hygiene** | Deletes its registrations in `afterAll`, closes editors / clears notifications in `afterEach`, leaves settings untouched, artifacts under gitignored `exp/playwright` |
| **Docs** | `docs/important/how-to-test.md`, README testing section, meta reference map |

Total: **20/20 E2E green**, typecheck clean, Prettier clean, and the legacy Mocha
scaffold left in place.

---

## 1. Problem

The extension had no `tests/` tree, no `playwright.config.ts`, no Make/npm E2E
targets, and no `docs/important/how-to-test.md`. Its behavior was only covered by
`src/test/suite/extension.test.ts`, which downloads VS Code, needs `xvfb`, and
cannot reach the code-server + CDP topology the rest of the repo uses.

Worse, it is the **foundation** of every other suite: a regression in the
falsy-boxing rule, the error shape, or the query-string form silently corrupts
all of them (the meta playbook records that the falsy bug already caused a
mis-read once).

## 2. Goal

A committed, runnable suite in the modern repo style:

- assertions on the **HTTP contract** of the control channel itself,
- the `custom.*` command surface and the workbench UI it drives,
- the two **outbound** integrations pointed at a deterministic local server,
- plus docs matching the code-server topology.

## 3. Design

```
Layer              Needs                          How
-----------------------------------------------------------------------------
HTTP contract      endpoint on HACKER_…_PORT       restResponse(): raw status/headers/body
Command surface    code-server + REST Control       custom.* / custom.eval
Outbound calls     runner loopback + code-server    local HTTP fixture server request log
Workbench UI       CDP browser (Playwright)         .statusbar-item, QuickInput, toasts
```

### Files

- `tests/playwright/rest.ts` — client; `restResponse()` exposes status, headers
  and body (the plain `restCmd`/`restEval` helpers return only the body, like the
  other suites).
- `tests/playwright/workbench.ts` — `connectWorkbench()`
  (`chromium.connectOverCDP`), status-bar/toast helpers, fixture-path and
  pid-file resolution, `dismissOverlays()`.
- `tests/playwright/fixtures.ts` — a small HTTP server on `127.0.0.1` that logs
  every request; the log is the oracle for event forwarding and formatting.
- `tests/playwright/rest-control.spec.ts` — 20 tests.
- `tests/playwright/workspace/` — committed fixtures (`rc-fixture.py`,
  `rc-fixture.log`); **nothing is written at runtime**.
- `playwright.config.ts`, `tsconfig.tests.json`.

### Why there is no iframe

REST Control contributes no view and no webview. Its visible surface is a
status-bar item, notifications, and the QuickInput widgets its `custom.show*`
commands open — all in the top-level workbench page. The suite therefore uses
plain Playwright locators, like path-picker.

### The oracle: a branded status item

The status bar is shared. The extension renders `$(plug) RC Port: <port>`; the
suite finds the item by the `/^RC Port: \d+$/` marker and asserts both the text
and the `aria-label` tooltip
(`REST Control: Listening on "http://127.0.0.1:<port>"`).

### The oracle: a loopback fixture server for outbound calls

`custom.registerEventHandler` and `custom.registerExternalFormatter` both call
**out** to an HTTP endpoint. The suite starts a fixture server on the runner's
`127.0.0.1`; because the code-server container runs with `network_mode: host`,
the extension host reaches it directly — the same trick stats-bar uses for its
fake `iftopd`. The fixture's **request log proves the call happened**; the tests
then assert the payload shape and, for the formatter, that the returned edit
actually landed in the document (applied in memory, reverted, never saved).

### Tests

| # | Test | Assert |
| --- | --- | --- |
| 1 | installed / activated / pinned port | version matches the checkout; `HACKER_REST_CONTROL_PORT` in the host; endpoint answers |
| 2 | status bar | `RC Port: <port>` text + listening tooltip |
| 3 | settings command | `restRemoteControl.openSettings` contributed and opens the Settings editor |
| 4 | falsy boxing | `false`/`0`/`''`/`undefined` → `null`; `({ value })` survives |
| 5 | error contract | unknown command / unknown extension / missing file → `400` + JSON `message` |
| 6 | headers | `access-control-allow-origin: *`, `content-type: application/json` |
| 7 | body vs query form | JSON body and `?command=…&args=…` both work; verb ignored |
| 8 | bind address | every non-loopback IPv4 refuses `:PORT` |
| 9 | extensions | `listInstalledExtensions` includes self; `getExtensionInfo` by id |
| 10 | workspace | folders shape + `workspaceFile === null` |
| 11 | commands | `getCommands` returns > 100 |
| 12 | `custom.eval` | arbitrary JS with `vscode` in scope |
| 13 | `goToFileLineCharacter` | opens at 1-based `:3:5` → 0-based selection echo; `currentFileContent`; `listOpenedFiles` |
| 14 | event handler | open + active-editor + selection events reach the fixture with the right payload |
| 15 | external formatter | fixture sees `{file,language,snippet}`; the returned text is applied |
| 16 | `showQuickPick` | default selection applied; picked item returned over REST |
| 17 | `showInputBox` | typed value returned |
| 18 | `showInformationMessage` | clicked button returned |
| 19 | `runInTerminal` | sends to the active terminal |
| 20 | pid bookkeeping | `<globalStorage>/<port>.pid` holds the extension-host pid |

## 4. Trials, errors and lessons learnt

These cost real time; recording them so the next person skips them.

### A. `editor.action.formatDocument` silently did nothing

The formatter probe opened a fixture, registered the external formatter, ran
`editor.action.formatDocument` — and the fixture server logged **zero** requests.
The workbench command needs an active editor and a working format provider
chain; invoking it over REST with no editor focus is a no-op (and reports
success). The deterministic path is `vscode.executeFormatDocumentProvider` with
the **real `Uri`** object, built inside `custom.eval`:

```js
const edits = await vscode.commands.executeCommand(
  "vscode.executeFormatDocumentProvider",
  vscode.window.activeTextEditor.document.uri,
);
```

*Lesson: don't drive a workbench command if a provider API answers the exact
question — and read the provider result, not "the command returned 200".*

### B. The README's `__type__` special-type arguments are **not implemented**

The README documents passing `{"__type__":"Uri","args":[…]}` for commands that
need VS Code types (`editor.action.goToLocations`), and `src/test/workspace1/`
even ships a `samples.http` example. Passing one produced:

```
Error: Invalid argument 'uri' when running 'vscode.executeFormatDocumentProvider', received: {
  "__type__": "Uri", "args": ["file:///…"] }
```

`requestProcessor.ts` has no `__type__` handling — args go to
`vscode.commands.executeCommand` as plain objects, and API commands reject them.
Only `custom.goToFileLineCharacter` builds `Uri`/`Position`/`Location` itself.

*Lessons: verify a documented contract against the **source** before building an
oracle on it; and don't trust a README example as a test fixture. Recorded as a
known gap in the new how-to-test doc (and the README got a `currentFileContent`
name fix while there).*

### C. Other extensions' formatters merge into your provider result

Registering the formatter for `markdown` and reading
`vscode.executeFormatDocumentProvider` returned **two** edits, with the fixture's
`UNIQUE_FORMAT_42\n` split across them (`"UNIQUE_FORMA"` + `"_42"`) — a second,
foreign formatter was active on `markdown`. The fix was to target a language with
no other provider. `.txt` mapped to the language id **`log`** in this install, so
the committed `.log` fixture is formatted under `log` and returns exactly one
clean edit.

*Lessons: don't assume a fixture's language id from its extension (probe
`document.languageId`); and pick a language no other installed extension
format-provides for, or the result is a merge.*

### D. A stale modal block intercepts every later click

After a full run, the QuickPick test failed with
`<div class="monaco-dialog-modal-block dimmed"> intercepts pointer events` — the
modal block that the workbench installs behind a quick input had stayed **above**
the widget, so Playwright's click retried for 30 s and aborted the pending REST
call. It passed in isolation, and a re-run passed: leftover state from manual
probes, not a code regression. Added `dismissOverlays()` (an `Escape` + settle)
to `beforeAll` and kept the per-test `Escape`.

*Lessons: the playbook's "a stuck dialog blocks everything" has a quiet sibling
in a pinned `.monaco-dialog-modal-block`; dismiss overlays before a suite, and
re-run a one-off before believing it.*

### E. `tsc -p ./` would compile the tests outside `rootDir`

`tsconfig.json` had no `include`, so adding `tests/**/*.ts` under `rootDir: src`
made `npm run test-compile` fail. Added `"include": ["src"]` (mirroring
path-picker) and a separate `tsconfig.tests.json` (`noEmit`, `DOM` lib) for the
suite.

*Lesson: a new top-level test tree needs both a scoped main tsconfig and its own
typecheck config.*

### F. Prettier is unpinned, and covers the new files

`npm run lint` runs `prettier --check './**/*.{js,ts}'`, so the new test files
must be Prettier-clean even though eslint only lints `src`. Running
`npx prettier --write` on the new files settled the double-quote/trailing-comma
differences. The only remaining warning is a **pre-existing** one:
`src/services/eventHandler.ts` (the repo runs an unpinned `npx prettier`, so a
newer Prettier reformats it differently than whatever wrote it).

*Lesson: match the repo's formatter config for new files; don't "fix" an
unrelated pre-existing formatting warning as part of a test-only change.*

### G. Settings changes would move the endpoint under the suite's feet

Reading the source: `onDidChangeConfiguration` for `restRemoteControl.*`
re-enters `setupRestControl`, which `tcpPorts.check`s the port — already held by
the extension itself — and, with no `fallbacks`, **rebinds on a random port**.
The stale-pid cleanup in that path can also resolve to the current extension host
and signal it. `enable: false` likewise disables the only channel the suite could
use to turn it back on. So the suite deliberately changes **no settings** and
documents `enable` / `fallbacks` / `port` as manual checks.

*Lesson: an extension that reconfigures itself on a settings change is hostile to
a shared workbench; don't toggle its settings from the suite.*

### H. The pid file lives in the mounted user-data dir, not the host's real one

The extension writes `<globalStorage>/<port>.pid`. The container mounts the meta
repo's `exp/code-server/.local/share/code-server`, but the host also has its own
`~/.local/share/code-server` — the two are different directories (stats-bar and
path-picker found the same trap). The check resolves the **mount source** and
skips with a message if it is not visible, with a
`REST_CONTROL_GLOBAL_STORAGE_DIR` override.

*Lesson: resolve profile paths to the host mount source, never the container
path.*

### I. The endpoint is loopback-only (and that is worth pinning)

The server binds `127.0.0.1`, not `0.0.0.0`. Probed: every non-loopback IPv4
(`192.168.x`, tailscale, docker bridges) refuses `:40620` while `127.0.0.1`
answers. Kept as a real test with a skip when no non-loopback interface exists.

*Lesson: security-relevant invariants (bind address, CORS scope) are cheap,
deterministic oracles over the HTTP surface.*

## 5. Verification

```sh
cd _submodules/vscode-hacker-rest-control
npm install
make typecheck-tests     # clean
npx prettier --check 'tests/**/*.ts' 'playwright.config.ts'   # clean

# the extension is already installed in the container's code-server data dir
make test-e2e            # 20 passed (~10 s) against code-server + CDP 9024
```

Run history / observations on the reference stack:

- Probes first (raw `fetch` + a throwaway Playwright script) pinned the status
  text, falsy boxing, `400` shape, query form, event payloads, formatter flow and
  loopback refusal.
- First full E2E: 15 passed, stopped at the QuickPick test (Trial D).
- After `dismissOverlays()`: **20 passed**, re-run twice more → 20 passed each.
- `make typecheck-tests`, `tsc -p ./` (src), and `make test-e2e` all green.

## 6. Follow-ups

- **`restRemoteControl.enable: false`** (server closes, `RC Disabled` status) and
  **`fallbacks` / a changed `port`** are documented manual checks: they rebind
  the server and would strand the suite (Trial G).
- **`custom.startDebugSession`** needs a real `launch.json`; not exercised.
- **`REMOTE_CONTROL_PORT` in terminals** is set via
  `environmentVariableCollection`; no public API reads it back and terminal
  output is not readable, so it is manual.
- **Saving a formatted document** is not tested — the meta repo is mounted
  read-only and the suite reverts in-memory edits.
- **Pure-logic layer:** the interesting pure helpers
  (`getPortFromEnvironment`, the workspace-hash, `isExtensionHostProcess`) are
  module-private; extracting them would enable `bun` units, but the HTTP/proc
  surface is the higher-value target and is covered.
- **Dev-host (Option B)** is supported by the helpers in principle but the
  committed suite targets code-server.

## 7. Lessons (consolidated)

### Test design

- **When the extension under test is the control channel, assert the channel's
  contract too** — falsy boxing, `400` + JSON error bodies, verb/query form,
  CORS, bind address. It is the cheapest and broadest regression net.
- **A local loopback fixture server is the oracle for outbound HTTP calls**; the
  request log proves the call, and the payload/echo proves the behavior.
- **Prefer a provider/reflection API over a workbench command** when the command
  has focus prerequisites and reports success on a no-op (Trial A).
- **Pick a language/context where your code is the only contributor** (Trial C),
  and probe the actual language id rather than inferring it from the extension.
- **Dismiss overlays before a suite**; a pinned modal block makes every click
  flaky and aborts pending control calls (Trial D).
- **Verify documented features against the source** before building an oracle on
  them (Trial B: `__type__`).

### Shared-workbench safety

- **Don't toggle the settings of an extension that rebinds or disables itself**
  on a settings change; cover those by hand (Trial G).
- **Resolve profile paths to the host mount source**, not the container path
  (Trial H).
- **Change no settings at all** when the subject's settings are load-bearing for
  the control channel; then there is nothing to restore.

### Tooling & packaging

- **A new top-level test tree needs its own tsconfig** and a scoped `include` in
  the main one (Trial E).
- **Match the repo's formatter for new files**; leave unrelated pre-existing
  warnings alone (Trial F).
- **Keep `tests/**`, configs and `docs/**` out of the VSIX** (`.vscodeignore`).
