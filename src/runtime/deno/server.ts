/**
 * Deno-only HTTP server and WebSocket support.
 * These are NOT part of the shared runtime interface — server mode is Deno-only.
 */

export type DenoHttpServer = Deno.HttpServer;

export interface ServeOptions {
  port: number;
  hostname?: string;
  onListen?: () => void;
}

export function serve(
  options: ServeOptions,
  handler: (req: Request) => Response | Promise<Response>,
): DenoHttpServer {
  return Deno.serve(options, handler);
}

export function upgradeWebSocket(request: Request): { socket: WebSocket; response: Response } {
  return Deno.upgradeWebSocket(request);
}
