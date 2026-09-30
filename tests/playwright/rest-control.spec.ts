import { test, expect, type Browser, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as net from "node:net";
import { restCmd, restEval, restRaw, restResponse } from "./rest";
import { startFixtureServer, type FixtureServer } from "./fixtures";
import {
  EXT_ID,
  EXT_ROOT,
  QUICK_INPUT,
  clearNotifications,
  connectWorkbench,
  dismissOverlays,
  fixturePath,
  fixtureText,
  globalStorageDir,
  nonLoopbackIPv4,
  rcStatusAria,
  rcStatusText,
  toast,
} from "./workbench";

/**
 * REST Control — code-server E2E (CDP browser on `CDP_PORT`).
 *
 * The extension under test is the control channel itself, so this suite both
 * *drives* through it and *asserts* its contract:
 *
 *   - the HTTP surface (falsy boxing, 400 errors, headers, query vs body form);
 *   - the `custom.*` command surface (workspace/files/eval/extensions);
 *   - the outbound integrations pointed at a local fixture server
 *     (`custom.registerEventHandler`, `custom.registerExternalFormatter`);
 *   - the workbench UI it drives (`custom.show*` → QuickInput/notifications);
 *   - the visible status-bar item and the `<port>.pid` bookkeeping.
 *
 * Prereqs: code-server up with this extension installed on the pinned port
 * (`make build` + install + reload tab; see `docs/important/how-to-test.md`),
 * the CDP browser reachable on 9024, and `HACKER_REST_CONTROL_PORT` (40620)
 * exported into the code-server container.
 */
test.describe.configure({ mode: "serial" });

const PORT = Number(process.env.HACKER_REST_CONTROL_PORT) || 40620;

let browser: Browser;
let page: Page;
let fix: FixtureServer;

/** The extension must be installed, activated, and answering on the pinned port. */
test.beforeAll(async () => {
  ({ browser, page } = await connectWorkbench());

  const installed = await restEval<{ id: string; active: boolean }>(`
		(async () => {
			const ext = vscode.extensions.getExtension(${JSON.stringify(EXT_ID)});
			if (!ext) throw new Error('not installed: ' + ${JSON.stringify(EXT_ID)});
			await ext.activate();
			return { id: ext.id, active: ext.isActive };
		})()
	`).catch((err) => {
    throw new Error(`REST Control is not usable on port ${PORT}: ${err}`);
  });
  expect(installed.id).toBe(EXT_ID);

  fix = await startFixtureServer();

  // The code-server workbench is a shared resource; start from a clean slate.
  await restCmd("workbench.action.closeAllEditors").catch(() => undefined);
  await clearNotifications();
  await dismissOverlays(page);
});

test.afterEach(async () => {
  // Dismiss any QuickInput left open by a failed interaction.
  if (
    await page
      .locator(QUICK_INPUT)
      .isVisible()
      .catch(() => false)
  ) {
    await page.keyboard.press("Escape");
  }
  await restCmd("workbench.action.closeAllEditors").catch(() => undefined);
  await clearNotifications();
});

test.afterAll(async () => {
  try {
    // Disposables the suite registered on the extension host.
    await restCmd("custom.registerEventHandler", "http://127.0.0.1:1/", [], "POST", "").catch(
      () => undefined,
    );
    await restCmd("custom.registerExternalFormatter", "http://127.0.0.1:1/", [], "POST", "").catch(
      () => undefined,
    );
    await restCmd("workbench.action.closeAllEditors").catch(() => undefined);
    await clearNotifications();
  } finally {
    await fix.stop();
    await browser.close();
  }
});

// ---------------------------------------------------------------------------
// Installation, activation, port pinning
// ---------------------------------------------------------------------------

test("is installed, activated, and listening on the pinned port", async () => {
  const pkg = JSON.parse(readFileSync(join(EXT_ROOT, "package.json"), "utf-8")) as {
    version: string;
  };
  const info = await restEval<{ version: string; active: boolean }>(`
		(async () => {
			const ext = vscode.extensions.getExtension(${JSON.stringify(EXT_ID)});
			return { version: ext.packageJSON.version, active: ext.isActive };
		})()
	`);
  // Guards a stale install shadowing the checkout (meta repo §9).
  expect(info.version).toBe(pkg.version);
  expect(info.active).toBe(true);

  // The `HACKER_REST_CONTROL_PORT` pin reaches the extension host…
  const envPort = await restEval<number | null>(
    "Number(process.env.HACKER_REST_CONTROL_PORT) || null",
  );
  expect(envPort).toBe(PORT);

  // …and the endpoint answers on it.
  expect(await restEval<number>("1 + 1")).toBe(2);
});

test("status bar shows the branded listening port and tooltip", async () => {
  await expect.poll(() => rcStatusText(page), { timeout: 15000 }).toBe(`RC Port: ${PORT}`);
  const aria = await rcStatusAria(page);
  expect(aria).toContain(`REST Control: Listening on "http://127.0.0.1:${PORT}"`);
});

test("contributes and runs its settings command", async () => {
  const commands = await restEval<string[]>("vscode.commands.getCommands(true)");
  expect(commands).toContain("restRemoteControl.openSettings");

  await restCmd("restRemoteControl.openSettings");
  await expect(page.locator(".settings-editor")).toBeVisible({ timeout: 15000 });
  await restCmd("workbench.action.closeActiveEditor");
});

// ---------------------------------------------------------------------------
// HTTP contract
// ---------------------------------------------------------------------------

test("falsy command results are boxed to null across the channel", async () => {
  // The server replies `JSON.stringify(data || null)`, so a legitimate
  // `false` / `0` / `''` arrives as `null`. Every other suite must box such
  // oracles in an object; this test pins that contract.
  expect(await restEval("false")).toBeNull();
  expect(await restEval("0")).toBeNull();
  expect(await restEval("''")).toBeNull();
  expect(await restEval("undefined")).toBeNull();

  expect(await restEval("({ value: false })")).toEqual({ value: false });
  expect(await restEval("({ value: 0 })")).toEqual({ value: 0 });
  expect(await restEval("({ value: '' })")).toEqual({ value: "" });
});

test("command failures return HTTP 400 with a JSON error", async () => {
  const unknown = await restResponse("no.such.command.xyz");
  expect(unknown.status).toBe(400);
  expect(String(unknown.body.message)).toContain("not found");

  const bogusExt = await restResponse("custom.getExtensionInfo", ["no.such.extension"]);
  expect(bogusExt.status).toBe(400);
  expect(String(bogusExt.body.message)).toContain("no.such.extension");

  const missingFile = await restResponse("custom.goToFileLineCharacter", [
    "definitely-no-such-file-xyz.py:1:1",
  ]);
  expect(missingFile.status).toBe(400);
  expect(String(missingFile.body.message)).toContain("Unable to locate file");
});

test("responses carry CORS + JSON headers", async () => {
  const res = await restResponse("custom.eval", ["1 + 1"]);
  expect(res.status).toBe(200);
  expect(res.headers["access-control-allow-origin"]).toBe("*");
  expect(res.headers["content-type"]).toContain("application/json");
});

test("accepts the JSON body and the query-string form; the verb is ignored", async () => {
  const body = await restResponse("custom.eval", ["21 * 2"]);
  expect(body.status).toBe(200);
  expect(body.body).toBe(42);

  // `?command=…&args=<url-encoded JSON>` — and a GET (the README says the verb
  // is ignored).
  const query = await restResponse("custom.eval", ["6 * 7"], { method: "GET", query: true });
  expect(query.status).toBe(200);
  expect(query.body).toBe(42);
});

test("the HTTP server binds loopback only", async () => {
  const ips = nonLoopbackIPv4();
  test.skip(ips.length === 0, "no non-loopback IPv4 interface to probe");

  const canConnect = (host: string): Promise<boolean> =>
    new Promise((resolve) => {
      const socket = new net.Socket();
      const done = (ok: boolean) => {
        socket.destroy();
        resolve(ok);
      };
      socket.setTimeout(1500);
      socket.once("connect", () => done(true));
      socket.once("timeout", () => done(false));
      socket.once("error", () => done(false));
      socket.connect(PORT, host);
    });

  for (const ip of ips.slice(0, 3)) {
    expect(await canConnect(ip), `${ip}:${PORT} should refuse connections`).toBe(false);
  }
});

// ---------------------------------------------------------------------------
// Custom command surface
// ---------------------------------------------------------------------------

test("lists installed extensions and reports one by id", async () => {
  const ids = await restCmd("custom.listInstalledExtensions");
  expect(ids).toContain(EXT_ID);

  const info = await restCmd("custom.getExtensionInfo", EXT_ID);
  expect(info.id).toBe(EXT_ID);
});

test("reports the workspace folders and the (absent) workspace file", async () => {
  const folders = await restCmd("custom.workspaceFolders");
  expect(Array.isArray(folders)).toBe(true);
  expect(folders.length).toBeGreaterThan(0);
  expect(folders[0]).toMatchObject({ name: expect.any(String), index: 0 });
  expect(String(folders[0].uri)).toMatch(/^file:\/\//);

  // code-server was opened on a folder, not a `.code-workspace`.
  expect(await restCmd("custom.workspaceFile")).toBeNull();
});

test("returns the registered command list", async () => {
  const commands = await restCmd("custom.getCommands");
  expect(Array.isArray(commands)).toBe(true);
  expect(commands.length).toBeGreaterThan(100);
});

test("custom.eval runs arbitrary JS with vscode in scope", async () => {
  expect(await restEval<number>("1 + 1")).toBe(2);
  const appName = await restEval<string>("vscode.env.appName");
  expect(typeof appName).toBe("string");
  expect(appName.length).toBeGreaterThan(0);
});

test("goToFileLineCharacter opens a file at the position (selection echo)", async () => {
  const py = fixturePath("rc-fixture.py");
  await restCmd("custom.goToFileLineCharacter", [`${py}:3:5`]);

  const sel = await restEval<{
    fsPath: string;
    line: number;
    character: number;
  }>(`(() => {
		const ed = vscode.window.activeTextEditor;
		return ed && { fsPath: ed.document.uri.fsPath, line: ed.selection.start.line, character: ed.selection.start.character };
	})()`);
  expect(sel.fsPath).toBe(py);
  expect(sel.line).toBe(2); // 1-based input "3" → 0-based 2
  expect(sel.character).toBe(4);

  // The round-trip: the host reflects the opened document back.
  expect(await restCmd("custom.currentFileContent")).toBe(fixtureText("rc-fixture.py"));
  const opened = await restCmd("custom.listOpenedFiles");
  expect(opened.some((f: string) => f.endsWith("rc-fixture.py"))).toBe(true);
});

// ---------------------------------------------------------------------------
// Outbound integrations (fixture server is the oracle)
// ---------------------------------------------------------------------------

test("registerEventHandler forwards editor events to the endpoint", async () => {
  const endpoint = `${fix.baseUrl}/events`;
  await restCmd(
    "custom.registerEventHandler",
    endpoint,
    [
      "vscode.window.onDidChangeActiveTextEditor",
      "vscode.window.onDidChangeTextEditorSelection",
      "vscode.workspace.onDidOpenTextDocument",
    ],
    "POST",
    "",
  );

  const py = fixturePath("rc-fixture.py");
  await restCmd("workbench.action.closeAllEditors");
  await restCmd("custom.goToFileLineCharacter", [`${py}:3:5`]);

  await expect
    .poll(() => fix.requestsFor("/events").length, { timeout: 10000 })
    .toBeGreaterThanOrEqual(3);

  const events = fix.requestsFor("/events").map((r) => r.body);
  const byName = (name: string) => events.find((e) => e.name === name);

  expect(byName("vscode.workspace.onDidOpenTextDocument")?.data).toBe(py);
  expect(byName("vscode.window.onDidChangeActiveTextEditor")?.data).toBe(py);

  const selection = byName("vscode.window.onDidChangeTextEditorSelection");
  expect(selection?.data?.fsPath).toBe(py);
  expect(selection?.data?.selections?.[0]?.start?.line).toBe(2);
  expect(selection?.data?.selections?.[0]?.start?.character).toBe(4);

  // The event handler is replaced on the next registration; dispose it here.
  await restCmd("custom.registerEventHandler", "http://127.0.0.1:1/", [], "POST", "");
});

test("registerExternalFormatter returns edits from the endpoint", async () => {
  fix.setFormatResponse("UNIQUE_FORMAT_42\n");
  await restCmd("custom.registerExternalFormatter", `${fix.baseUrl}/format`, ["log"], "POST", "");

  const log = fixturePath("rc-fixture.log");
  await restCmd("custom.goToFileLineCharacter", [`${log}:1:1`]);

  const result = await restEval<{
    found: boolean;
    newText: string | null;
    content: string | null;
  }>(`(async () => {
		const ed = vscode.window.activeTextEditor;
		const edits = await vscode.commands.executeCommand('vscode.executeFormatDocumentProvider', ed.document.uri);
		const ours = (edits || []).find((e) => e.newText && e.newText.includes('UNIQUE_FORMAT_42'));
		let content = null;
		if (ours) {
			await ed.edit((b) => { b.replace(ours.range, ours.newText); });
			content = ed.document.getText();
		}
		return { found: !!ours, newText: ours ? ours.newText : null, content };
	})()`);

  // The endpoint saw the document payload…
  const requests = fix.requestsFor("/format");
  expect(requests.length).toBeGreaterThan(0);
  expect(requests[0].body.file).toBe(log);
  expect(requests[0].body.language).toBe("log");
  expect(requests[0].body.snippet).toBe(fixtureText("rc-fixture.log"));

  // …and the provider's edit was applied to the (unsaved) document.
  expect(result.found).toBe(true);
  expect(result.newText).toContain("UNIQUE_FORMAT_42");
  expect(result.content).toContain("UNIQUE_FORMAT_42");

  await restCmd("workbench.action.revertAndCloseActiveEditor");
});

// ---------------------------------------------------------------------------
// Workbench UI driven through `custom.show*`
// ---------------------------------------------------------------------------

test("showQuickPick returns the picked item (default selection applied)", async () => {
  const pending = restRaw("custom.showQuickPick", [
    {
      title: "RC E2E Pick",
      placeHolder: "choose one",
      items: [{ label: "Alpha" }, { label: "Beta" }, { label: "Gamma" }],
      defaultLabel: "Beta",
    },
  ]);

  const widget = page.locator(QUICK_INPUT);
  await expect(widget).toBeVisible({ timeout: 10000 });
  await expect(page.locator(`${QUICK_INPUT} .quick-input-title`)).toHaveText("RC E2E Pick");
  await expect(widget.locator(".monaco-list-row.focused")).toContainText("Beta");

  await widget.locator(".monaco-list-row", { hasText: "Gamma" }).first().click();
  expect(await pending).toEqual([{ label: "Gamma" }]);
});

test("showInputBox returns the typed value", async () => {
  const pending = restRaw("custom.showInputBox", [
    { placeHolder: "type something", prompt: "RC E2E Input" },
  ]);

  const widget = page.locator(QUICK_INPUT);
  await expect(widget).toBeVisible({ timeout: 10000 });
  await widget.locator("input").fill("rc-e2e-value");
  await page.keyboard.press("Enter");

  expect(await pending).toBe("rc-e2e-value");
});

test("showInformationMessage returns the clicked button", async () => {
  const pending = restRaw("custom.showInformationMessage", ["RC E2E Message", "Yes", "No"]);

  const t = toast(page, "RC E2E Message");
  await expect(t).toBeVisible({ timeout: 10000 });
  await t.getByRole("button", { name: "Yes" }).click();

  expect(await pending).toBe("Yes");
});

test("runInTerminal sends to the active terminal", async () => {
  await restCmd("workbench.action.terminal.new");
  await expect
    .poll(() => restEval<boolean>("!!vscode.window.activeTerminal"), { timeout: 15000 })
    .toBe(true);

  const res = await restResponse("custom.runInTerminal", ["echo RC_E2E_TERMINAL"]);
  expect(res.status).toBe(200);

  await restCmd("workbench.action.terminal.killAll");
});

// ---------------------------------------------------------------------------
// Port bookkeeping (topology-specific; skipped when the path is not mounted)
// ---------------------------------------------------------------------------

test("records the extension-host pid for its listening port", async () => {
  const pidFile = join(globalStorageDir(), `${PORT}.pid`);
  test.skip(!existsSync(pidFile), `pid file not visible on the runner: ${pidFile}`);

  const pid = await restEval<number>("process.pid");
  expect(readFileSync(pidFile, "utf-8").trim()).toBe(String(pid));
});
