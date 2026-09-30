/**
 * REST Control client + raw HTTP helpers for the REST Control E2E suite.
 *
 * This suite is unusual: the extension under test **is** the control channel
 * every other suite uses to arrange/act. So the client doubles as the
 * system-under-test surface — we POST to the extension's own endpoint and
 * assert the HTTP contract (status codes, headers, the falsy-boxing rule,
 * query-string vs JSON body) as well as the workbench DOM and the outbound
 * integrations (event handler / external formatter) over CDP.
 *
 * See `docs/important/how-to-test-all.md` §3 in the meta repo:
 * "REST → arrange + act, CDP → assert only".
 *
 * The port is pinned by `HACKER_REST_CONTROL_PORT` in the meta repo's
 * `docker-compose.yml` (40620 by default).
 */

const REST_PORT = Number(process.env.HACKER_REST_CONTROL_PORT) || 40620;
export const REST_URL = `http://127.0.0.1:${REST_PORT}/`;

export interface RestResponse {
  status: number;
  headers: Record<string, string>;
  body: any;
}

export interface RestRequestOptions {
  /** HTTP verb. The extension ignores it (the README documents this). */
  method?: string;
  /**
   * Use the `?command=…&args=<url-encoded JSON>` query form instead of a JSON
   * body. The README documents both as equivalent.
   */
  query?: boolean;
  timeoutMs?: number;
}

/**
 * Low-level request that returns the **full** HTTP response. Most callers want
 * `restRaw`/`restCmd`; the error-contract tests need the status and headers.
 */
export async function restResponse(
  command: string,
  args: unknown[] = [],
  options: RestRequestOptions = {},
): Promise<RestResponse> {
  const { method = "POST", query = false, timeoutMs = 30000 } = options;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    let url = REST_URL;
    let body: string | undefined;
    if (query) {
      url = `${REST_URL}?command=${encodeURIComponent(command)}&args=${encodeURIComponent(
        JSON.stringify(args),
      )}`;
    } else {
      body = JSON.stringify({ command, args });
    }
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body,
      signal: ac.signal,
    });
    const text = await res.text();
    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return {
      status: res.status,
      headers: Object.fromEntries(res.headers.entries()),
      body: parsed,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** POST `{ command, args }` and return the decoded body (or `null`). */
export async function restRaw(
  command: string,
  args: unknown[] = [],
  timeoutMs = 30000,
): Promise<any> {
  const res = await restResponse(command, args, { timeoutMs });
  return res.body;
}

/** Run a VS Code command via `vscode.commands.executeCommand`. */
export function restCmd(command: string, ...args: unknown[]): Promise<any> {
  return restRaw(command, args);
}

/** Evaluate arbitrary JS in the extension host (`vscode` is in scope). */
export async function restEval<T = unknown>(code: string, timeoutMs = 30000): Promise<T> {
  const result = await restRaw("custom.eval", [code], timeoutMs);
  if (result && typeof result === "object" && (result as { name?: string }).name === "Error") {
    throw new Error(`restEval failed: ${(result as { message?: string }).message}`);
  }
  return result as T;
}

/** True when the REST Control endpoint is reachable. */
export async function restAvailable(): Promise<boolean> {
  try {
    return (await restEval<number>("1 + 1")) === 2;
  } catch {
    return false;
  }
}
