/**
 * Local HTTP fixture server for the REST Control E2E suite.
 *
 * REST Control makes **outbound** HTTP calls for two features:
 *
 *   - `custom.registerEventHandler` forwards VS Code events to a configured
 *     endpoint (and the request log is the ground truth that an event fired);
 *   - `custom.registerExternalFormatter` asks an endpoint to format a document.
 *
 * The extension host runs inside the code-server container with
 * `network_mode: host` (see `docker-compose.yml`), so it reaches the runner's
 * `127.0.0.1` directly — the same trick the stats-bar suite uses for its fake
 * `iftopd`. Binding loopback keeps the fixture private.
 */
import * as http from "node:http";

export interface FixtureRequest {
  method: string;
  /** Path only (query stripped). */
  url: string;
  /** Parsed JSON body when it parses, otherwise the raw string. */
  body: any;
  raw: string;
}

export interface FixtureServer {
  /** e.g. `http://127.0.0.1:54321`. */
  readonly baseUrl: string;
  readonly requests: FixtureRequest[];
  /** Body the `/format` endpoint returns (the fake formatter's output). */
  setFormatResponse(text: string): void;
  /** Requests seen for a path, e.g. `/events`. */
  requestsFor(path: string): FixtureRequest[];
  stop(): Promise<void>;
}

export async function startFixtureServer(): Promise<FixtureServer> {
  const requests: FixtureRequest[] = [];
  let formatResponse = "FORMATTED_BY_FIXTURE\n";

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk as Buffer));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8");
      let body: any = raw;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = raw;
      }
      requests.push({
        method: req.method || "GET",
        url: (req.url || "/").split("?")[0],
        body,
        raw,
      });
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(formatResponse);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("fixture server did not bind a TCP port");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    setFormatResponse(text: string) {
      formatResponse = text;
    },
    requestsFor(path: string) {
      return requests.filter((r) => r.url === path);
    },
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
