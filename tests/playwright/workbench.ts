/**
 * Workbench + status-bar helpers for the REST Control E2E suite.
 *
 * Division of labour (meta repo `how-to-test-all.md` §3):
 *   REST Control  → arrange + act   (the extension under test, and the channel)
 *   CDP/Playwright → assert only     (the status-bar item, toasts, the
 *                                     QuickPick/InputBox widgets it drives)
 *
 * REST Control contributes no view and no webview — its visible surface is a
 * status-bar item (`RC Port: <port>`), notifications, and the QuickInput
 * widgets its `custom.show*` commands open. So Playwright asserts the
 * **top-level workbench page**; there is no iframe to descend into.
 */
import { chromium, expect, type Browser, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { restAvailable, restCmd } from "./rest";

export const CDP_ENDPOINT = `http://127.0.0.1:${process.env.CDP_PORT || "9024"}`;
export const CODE_SERVER_ORIGIN = process.env.CODE_SERVER_ORIGIN || "https://localhost:9620";
const CODE_SERVER_HOST = new URL(CODE_SERVER_ORIGIN).host;

/** The extension under test (override for a fork). */
export const EXT_ID = process.env.REST_CONTROL_EXT_ID || "lamnguyenx.vscode-hacker-rest-control";

const HERE = __dirname; // tests/playwright
/** This extension's checkout, as both the runner and the extension host see it. */
export const EXT_ROOT: string = process.env.REST_CONTROL_EXT_ROOT || join(HERE, "..", "..");
/** The meta repo that contains this submodule (the code-server workspace folder). */
export const META_ROOT = join(EXT_ROOT, "..", "..");
/** Committed fixtures opened/edited by the suite. */
export const FIXTURE_DIR = join(EXT_ROOT, "tests", "playwright", "workspace");

export interface Workbench {
  browser: Browser;
  page: Page;
}

/** Connect to the already-running CDP browser and return the code-server tab. */
export async function connectWorkbench(): Promise<Workbench> {
  const browser = await chromium.connectOverCDP(CDP_ENDPOINT);
  const context = browser.contexts()[0];
  if (!context) throw new Error(`no browser context on ${CDP_ENDPOINT}`);

  const page =
    context.pages().find((p) => p.url().includes(CODE_SERVER_HOST)) ?? (await context.newPage());
  if (!page.url().includes(CODE_SERVER_HOST)) {
    await page.goto(CODE_SERVER_ORIGIN, { waitUntil: "domcontentloaded" });
  }
  await page.locator(".monaco-workbench").waitFor({ timeout: 30000 });
  return { browser, page };
}

/** Poll until the REST Control endpoint answers (e.g. after a reload). */
export async function waitForRest(timeoutMs = 30000): Promise<void> {
  await expect
    .poll(() => restAvailable().catch(() => false), {
      timeout: timeoutMs,
      intervals: [500, 1000, 2000],
    })
    .toBe(true);
}

/**
 * Dismiss any stale modal/quick-input overlay left by a previous run. A pinned
 * modal block intercepts pointer events and makes every later click flaky (meta
 * repo `how-to-test-all.md` §7 "A stuck dialog blocks everything").
 */
export async function dismissOverlays(page: Page): Promise<void> {
  await page.keyboard.press("Escape").catch(() => undefined);
  await page.waitForTimeout(150);
}

// ---------------------------------------------------------------------------
// Status bar — the extension's only always-on visible surface.
//
// Brand the lookup with the `RC Port:` prefix so we never match another
// extension's item (meta repo `how-to-test-all.md` §6).
// ---------------------------------------------------------------------------

export interface StatusItem {
  text: string;
  aria: string;
  left: boolean;
  right: boolean;
}

export function statusItems(page: Page): Promise<StatusItem[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll(".statusbar-item")].map((el) => {
      const className = el.className || "";
      return {
        text: (el.textContent || "").replace(/\s+/g, " ").trim(),
        aria: el.getAttribute("aria-label") || "",
        left: className.includes("left"),
        right: className.includes("right"),
      };
    }),
  );
}

/** The `RC Port: <n>` status-bar item text, or `null` while it is absent. */
export async function rcStatusText(page: Page): Promise<string | null> {
  const item = (await statusItems(page)).find((i) => /^RC Port: \d+$/.test(i.text));
  return item ? item.text : null;
}

/** The `RC Port:` item's aria-label (carries the full listening message). */
export async function rcStatusAria(page: Page): Promise<string | null> {
  const item = (await statusItems(page)).find((i) => i.text.startsWith("RC Port:"));
  return item ? item.aria : null;
}

// ---------------------------------------------------------------------------
// Notifications + QuickInput — the `custom.show*` commands drive workbench UI.
// ---------------------------------------------------------------------------

export const QUICK_INPUT = ".quick-input-widget";

/** Remove leftover notification toasts. */
export function clearNotifications(): Promise<any> {
  return restCmd("notifications.clearAll").catch(() => undefined);
}

/** Locator for a notification toast matching `text`. */
export function toast(page: Page, text: string) {
  return page.locator(".notifications-toasts .notification-toast", { hasText: text }).first();
}

// ---------------------------------------------------------------------------
// Paths / environment — resolve as the extension host sees them.
// ---------------------------------------------------------------------------

/** Read a committed fixture as text. */
export function fixtureText(name: string): string {
  return readFileSync(join(FIXTURE_DIR, name), "utf-8");
}

/** Absolute path of a committed fixture (the host and runner share the path). */
export function fixturePath(name: string): string {
  return join(FIXTURE_DIR, name);
}

/**
 * Where the extension writes its `<port>.pid` file, on the runner's filesystem.
 * The code-server container mounts the meta repo's `exp/code-server` user-data
 * dir, so the runner can read it directly. Override for a different topology.
 */
export function globalStorageDir(): string {
  return (
    process.env.REST_CONTROL_GLOBAL_STORAGE_DIR ||
    join(
      META_ROOT,
      "exp",
      "code-server",
      ".local",
      "share",
      "code-server",
      "User",
      "globalStorage",
      EXT_ID,
    )
  );
}

/** Non-loopback IPv4 addresses of this machine (for the bind-address check). */
export function nonLoopbackIPv4(): string[] {
  const out: string[] = [];
  for (const addrs of Object.values(networkInterfaces())) {
    for (const addr of addrs || []) {
      if (addr.family === "IPv4" && !addr.internal) out.push(addr.address);
    }
  }
  return out;
}
