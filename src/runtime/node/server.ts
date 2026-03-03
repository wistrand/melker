/**
 * Node.js HTTP server and WebSocket support.
 * Drop-in replacement for the Deno-only runtime/deno/server.ts.
 *
 * HTTP serving uses node:http with a Web Request/Response bridge.
 * WebSocket upgrades use the `ws` package, bridging Deno's synchronous
 * upgradeWebSocket(req) → { socket, response } pattern with Node's
 * event-based http 'upgrade' event.
 */

import { createServer, type Server, type IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket as WsWebSocket } from 'ws';

export interface ServeOptions {
  port: number;
  hostname?: string;
  onListen?: () => void;
}

// ── Pending-upgrade coordination ─────────────────────────────────────────────
// When the handler calls upgradeWebSocket(req), it stores a deferred here keyed
// by request URL. The http 'upgrade' event resolves it with the real ws socket.

interface UpgradeDeferred {
  resolve: (ws: WsWebSocket) => void;
  reject: (err: Error) => void;
}

const _pendingUpgrades = new Map<string, UpgradeDeferred>();

// ── WebSocket adapter ────────────────────────────────────────────────────────
// Wraps a ws.WebSocket (delivered asynchronously) in the browser WebSocket
// interface that src/server.ts expects (onopen, onmessage, onclose, onerror,
// send, close).

function createWebSocketAdapter(wsPromise: Promise<WsWebSocket>): WebSocket {
  let realWs: WsWebSocket | null = null;
  const sendQueue: string[] = [];

  const adapter: any = {
    onopen: null as ((ev?: any) => void) | null,
    onmessage: null as ((ev: { data: any }) => void) | null,
    onclose: null as ((ev?: any) => void) | null,
    onerror: null as ((ev?: any) => void) | null,

    send(data: string) {
      if (realWs && realWs.readyState === 1 /* OPEN */) {
        realWs.send(data);
      } else {
        sendQueue.push(data);
      }
    },

    close() {
      if (realWs) realWs.close();
    },
  };

  wsPromise.then((ws) => {
    realWs = ws;

    // Flush queued sends
    for (const msg of sendQueue) ws.send(msg);
    sendQueue.length = 0;

    // Wire ws events → adapter callbacks
    ws.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
      adapter.onmessage?.({ data: data.toString() });
    });
    ws.on('close', () => {
      adapter.onclose?.();
    });
    ws.on('error', (err: Error) => {
      adapter.onerror?.(err);
    });

    // ws considers the connection open immediately after handleUpgrade,
    // so fire onopen synchronously here.
    adapter.onopen?.();
  });

  return adapter as unknown as WebSocket;
}

/**
 * Build a Web Headers object from Node's IncomingMessage headers.
 */
function buildHeaders(nodeHeaders: Record<string, string | string[] | undefined>): Headers {
  const headers = new Headers();
  for (const [key, val] of Object.entries(nodeHeaders)) {
    if (val !== undefined) {
      if (Array.isArray(val)) {
        for (const v of val) headers.append(key, v);
      } else {
        headers.set(key, val);
      }
    }
  }
  return headers;
}

// ── NodeHttpServer ───────────────────────────────────────────────────────────

/**
 * Wrapper around Node's http.Server that matches the DenoHttpServer interface
 * used by src/server.ts and src/oauth/callback-server.ts.
 */
export class NodeHttpServer {
  private _server: Server;
  private _handler: (req: Request) => Response | Promise<Response>;
  /** Resolves once the underlying http.Server is listening on its port. */
  readonly ready: Promise<void>;
  private _readyResolve!: () => void;

  constructor(server: Server, handler: (req: Request) => Response | Promise<Response>) {
    this._server = server;
    this._handler = handler;
    this.ready = new Promise((resolve) => { this._readyResolve = resolve; });
  }

  /** Called by serve() once server.listen() completes. */
  _markReady(): void {
    this._readyResolve();
  }

  async shutdown(): Promise<void> {
    return new Promise((resolve, reject) => {
      this._server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  get server(): Server {
    return this._server;
  }
}

export type DenoHttpServer = NodeHttpServer;

// ── serve() ──────────────────────────────────────────────────────────────────

/**
 * Serve HTTP requests using Node's http module.
 * Matches the Deno.serve() signature used by Melker.
 */
export function serve(
  options: ServeOptions,
  handler: (req: Request) => Response | Promise<Response>,
): NodeHttpServer {
  const wss = new WebSocketServer({ noServer: true });

  const server = createServer(async (nodeReq, nodeRes) => {
    try {
      const host = nodeReq.headers.host || `localhost:${options.port}`;
      const url = `http://${host}${nodeReq.url || '/'}`;

      // Build a Web Request from the Node request
      const headers = buildHeaders(nodeReq.headers);

      const hasBody = nodeReq.method !== 'GET' && nodeReq.method !== 'HEAD';
      let body: ReadableStream<Uint8Array> | null = null;
      if (hasBody) {
        body = new ReadableStream({
          start(controller) {
            nodeReq.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
            nodeReq.on('end', () => controller.close());
            nodeReq.on('error', (err) => controller.error(err));
          },
        });
      }

      const request = new Request(url, {
        method: nodeReq.method || 'GET',
        headers,
        body,
        // @ts-ignore -- duplex needed for Node streams
        duplex: hasBody ? 'half' : undefined,
      });

      const response = await handler(request);

      // WebSocket upgrade — handled by the 'upgrade' event below
      if (_isUpgradeResponse(response)) return;

      // Write the Web Response back to Node
      nodeRes.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      if (response.body) {
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          nodeRes.write(value);
        }
      }
      nodeRes.end();
    } catch {
      if (!nodeRes.headersSent) {
        nodeRes.writeHead(500);
      }
      nodeRes.end();
    }
  });

  // Handle WebSocket upgrades via the 'upgrade' event.
  // In Node, upgrade requests bypass the normal request handler entirely,
  // so we must build a Web Request, call the handler (for auth + upgradeWebSocket),
  // then complete the upgrade with the ws library.
  server.on('upgrade', async (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    try {
      const host = req.headers.host || `localhost:${options.port}`;
      const url = `http://${host}${req.url || '/'}`;

      // Build a Web Request from the IncomingMessage
      const headers = buildHeaders(req.headers);
      const request = new Request(url, { method: req.method || 'GET', headers });

      // Call the handler — this validates the token and calls upgradeWebSocket()
      const response = await handler(request);

      if (_isUpgradeResponse(response)) {
        // Handler called upgradeWebSocket() — complete the upgrade
        const deferred = _pendingUpgrades.get(request.url);
        if (deferred) {
          _pendingUpgrades.delete(request.url);
          wss.handleUpgrade(req, socket, head, (ws) => {
            deferred.resolve(ws);
          });
        } else {
          socket.destroy();
        }
      } else {
        // Auth failed — write the HTTP response directly to the socket
        const statusText = response.status === 401 ? 'Unauthorized' : String(response.status);
        const body = await response.text();
        socket.write(
          `HTTP/1.1 ${response.status} ${statusText}\r\n` +
          `Content-Length: ${Buffer.byteLength(body)}\r\n` +
          `Content-Type: text/plain\r\n` +
          `\r\n` +
          body,
        );
        socket.end();
      }
    } catch {
      socket.destroy();
    }
  });

  const nodeServer = new NodeHttpServer(server, handler);

  const hostname = options.hostname || 'localhost';
  server.listen(options.port, hostname, () => {
    nodeServer._markReady();
    options.onListen?.();
  });

  return nodeServer;
}

// ── upgradeWebSocket() ───────────────────────────────────────────────────────

/**
 * Upgrade an HTTP request to a WebSocket connection.
 * Returns { socket, response } matching the Deno.upgradeWebSocket() signature.
 *
 * The socket is a browser-WebSocket-compatible adapter. The actual ws handshake
 * happens asynchronously in the http 'upgrade' event; the adapter buffers sends
 * and defers event wiring until the real socket is ready.
 */
// Sentinel status for WebSocket upgrade responses.
// Node's Web Response API rejects status 101 (only 200-599 allowed), so we use
// a custom header to signal "this is an upgrade" with a valid status code.
const WS_UPGRADE_STATUS = 200;
const WS_UPGRADE_HEADER = 'X-Melker-WS-Upgrade';

export function upgradeWebSocket(request: Request): { socket: WebSocket; response: Response } {
  const { promise, resolve, reject } = Promise.withResolvers<WsWebSocket>();
  _pendingUpgrades.set(request.url, { resolve, reject });

  const socket = createWebSocketAdapter(promise);
  // Use a sentinel header instead of status 101 (which Node's Response rejects)
  const response = new Response(null, {
    status: WS_UPGRADE_STATUS,
    headers: { [WS_UPGRADE_HEADER]: '1' },
  });
  return { socket, response };
}

/** Check if a response signals a WebSocket upgrade. */
function _isUpgradeResponse(response: Response): boolean {
  return response.headers.get(WS_UPGRADE_HEADER) === '1';
}
