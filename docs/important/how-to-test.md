# How to Test REST Control

> **General rules live in the meta repo** —
> [`how-to-test-all.md`](../../../../docs/important/how-to-test-all.md). Read it
> first: it consolidates environment choice, the control-channel-vs-CDP model,
> determinism, state hygiene, ports/paths, cache-busting, A/B isolation, and
> flakiness. This document keeps only what is specific to *REST Control*.

REST Control is the **control channel** every other extension's E2E suite uses
to arrange and act. That makes its own suite a little unusual: the extension
under test *is* the thing the suite drives through, so the tests assert both the
workbench DOM and the HTTP contract of the channel itself.

REST Control has two committed layers:

| Layer | Where | Needs | Run |
| --- | --- | --- | --- |
| **E2E** | `tests/playwright/` (`@playwright/test`) | code-server + CDP browser + REST Control | `make test-e2e` |
| **Legacy host tests** | `src/test/suite/` (`@vscode/test-electron` + Mocha) | a local VS Code download (`xvfb-run`) | `npm test` |

The E2E suite arranges/acts through **the REST endpoint under test** and asserts
over CDP (`how-to-test-all.md` §3, "REST → arrange + act, CDP → assert only").
There is no webview/iframe: the extension's visible surface is a status-bar
item, notifications, and the QuickInput widgets its `custom.show*` commands
open — all rendered in the top-level workbench page.

## 0. Prerequisites (code-server, Option A)

Start the reference stack from the meta repo (`docker-compose.yml`), install
this extension, and make sure the CDP browser is reachable:

```bash
# build + install into the *container's* code-server data dir
make build
EXT=/home/lamnt45/git/vscode-hacker-meta/exp/code-server/.local/share/code-server/extensions
UD=/home/lamnt45/git/vscode-hacker-meta/exp/code-server/.local/share/code-server
code-server --extensions-dir "$EXT" --user-data-dir "$UD" \
  --install-extension build/lamnguyenx.vscode-hacker-rest-control-*.vsix --force

# CDP browser + REST Control must be up:
curl -s http://127.0.0.1:9024/json/version     # browser
curl -s -X POST http://127.0.0.1:40620/ -H 'Content-Type: application/json' \
  -d '{"command":"custom.eval","args":["1+1"]}'   # REST Control -> 2
```

The meta repo's `docker-compose.yml` pins the endpoint with
`HACKER_REST_CONTROL_PORT: ${HACKER_REST_CONTROL_PORT:-40620}` so a
workspace-hash change cannot move it. `CDP_PORT` (default `9024`) and
`HACKER_REST_CONTROL_PORT` (default `40620`) are the only knobs; both read from
the environment.

> A just-reinstalled extension is only picked up after the extension host
> restarts (reload the browser tab). The suite checks the installed
> `packageJSON.version` against the checkout and fails loudly on a stale build.

## 1. E2E suite

```bash
make typecheck-tests                  # strict tsc over tests/ + config
make test-e2e                         # CDP_PORT=9024 npm run test:e2e
# or: CDP_PORT=9024 npx playwright test --config playwright.config.ts
```

Files:

- `tests/playwright/rest.ts` — REST client; `restResponse` exposes the raw
  status/headers for the HTTP-contract checks.
- `tests/playwright/workbench.ts` — connect/CDP, status-bar and toast helpers,
  path resolution, the pid-file lookup, overlay dismissal.
- `tests/playwright/fixtures.ts` — a local HTTP server that records requests;
  it is the oracle for the two **outbound** integrations.
- `tests/playwright/rest-control.spec.ts` — the 20 checks.
- `tests/playwright/workspace/` — committed fixtures (`rc-fixture.py`,
  `rc-fixture.log`); nothing is written at runtime.

What the checks cover:

- **Install/activation/port** — installed version matches the checkout; the
  `HACKER_REST_CONTROL_PORT` pin reaches the extension host; the endpoint
  answers; the status bar shows `RC Port: <n>` with the listening tooltip.
- **HTTP contract** — the falsy-boxing rule (below), `400` + JSON error bodies,
  CORS/JSON headers, JSON body vs `?command=…&args=…` query form, verb ignored,
  loopback-only bind.
- **`custom.*` surface** — extensions, workspace folders/file, command list,
  `custom.eval`, `custom.goToFileLineCharacter` (selection echo),
  `custom.currentFileContent`, `custom.listOpenedFiles`.
- **Outbound integrations** — `custom.registerEventHandler` forwards
  open/active/selection events to the fixture server with the right payload;
  `custom.registerExternalFormatter` receives `{file, language, snippet}` and
  its returned text is applied as a document edit.
- **Workbench UI** — `custom.showQuickPick` (default selection + pick),
  `custom.showInputBox` (typed value), `custom.showInformationMessage` (clicked
  button), `custom.runInTerminal`; `restRemoteControl.openSettings` opens the
  Settings editor.
- **Bookkeeping** — the `<globalStorage>/<port>.pid` file records the extension
  host pid.

### The falsy-boxing contract (read this if you consume the channel)

The server replies with `JSON.stringify(data || null)`, so a legitimate `false`,
`0`, or `''` arrives as **`null`**. The suite pins this:

```ts
await restEval('false')          // null
await restEval('0')              // null
await restEval("''")             // null
await restEval('({ value: false })')  // { value: false }  ← box falsy oracles
```

Every other suite must wrap falsy oracle values in an object (`({ value })`); a
bare `enabled === false` assertion would silently read as "unset"
(`how-to-test-all.md` §3).

### How the outbound integrations are tested

REST Control calls **out** to HTTP endpoints for event forwarding and external
formatting. The suite starts a local fixture server on `127.0.0.1` and points
the extension at it. The code-server container runs with `network_mode: host`
(see `docker-compose.yml`), so the extension host reaches the runner's loopback
directly — the same trick the stats-bar suite uses for its fake `iftopd`.
Binding loopback keeps the fixture private.

The fixture's **request log is the ground truth** that an event fired or a
formatter ran; the assertions then check the payload shape/values and, for the
formatter, that the returned edit actually landed in the document (reverted, not
saved).

## 2. The pid-file check

The extension writes its listening port's pid to
`<globalStorage>/<port>.pid`; the code-server container mounts the meta repo's
`exp/code-server` user-data dir, so the runner reads it directly. Override the
location with `REST_CONTROL_GLOBAL_STORAGE_DIR` for a different topology; the
check skips (with a message) when the file is not visible to the runner.

## 3. State hygiene

- The suite changes **no settings** — `restRemoteControl.*` is left untouched,
  because changing any key under that section restarts the server (and, with a
  pinned port already in use by the extension itself, can fall back to a random
  port). If you add a test that changes these settings, snapshot/restore the
  Global scope and expect the endpoint to move.
- `afterEach` closes editors and clears notifications; `afterAll` disposes the
  event handler + formatter registrations, stops the fixture server, and
  disconnects.
- Playwright artifacts go to `exp/playwright` (gitignored).
- The E2E suite is serial (`test.describe.configure({ mode: 'serial' })`) and
  the workbench is shared: restart code-server between larger batches
  (`how-to-test-all.md` §7).

## 4. Manual / known limits

These have no safe deterministic oracle against the shared workbench, so they
are **not** in the committed suite:

- **`restRemoteControl.enable: false`** closes the server and shows
  `RC Disabled` — but it also disables the control channel the test would use to
  turn it back on, and a config change re-enters `setupRestControl`, whose stale
  pid cleanup can signal the current extension host. Verify by hand on a
  throwaway instance.
- **`restRemoteControl.fallbacks` / a changed `restRemoteControl.port`** — both
  rebind the server; on a pinned port that self-conflicts. Verify by hand.
- **The `REMOTE_CONTROL_PORT` terminal env var** is set via
  `environmentVariableCollection`; there is no public API to read it back, and
  terminal output is not readable through the API.
- **Saving a formatted document** — the meta repo is mounted read-only, and the
  suite reverts rather than saves. The edit itself is covered.
- **`custom.startDebugSession`** needs a real `launch.json`; not exercised here.
- **`__type__` special-type arguments** (`Uri`/`Position`/`Location`) described
  in the README are **not implemented** in `requestProcessor.ts`: args are
  passed to `vscode.commands.executeCommand` as plain objects, and API commands
  reject them ("Invalid argument 'uri'"). Use `custom.goToFileLineCharacter`,
  which builds the types itself.
