// OAuth callback server for handling authorization redirects

import type { CallbackServerOptions, CallbackResult } from './types.ts';
import { getAsset } from '../assets.ts';

// No-cache headers for all responses
const NO_CACHE_HEADERS = {
  'cache-control': 'no-cache, no-store, must-revalidate',
  'pragma': 'no-cache',
  'expires': '0',
};

/**
 * HTTP server to receive OAuth authorization callback
 */
export class OAuthCallbackServer {
  private _server?: Deno.HttpServer;
  private _options: Required<CallbackServerOptions>;
  private _codeResolve?: (result: CallbackResult) => void;
  private _codeReject?: (error: Error) => void;
  private _timeoutId?: number;

  constructor(options: CallbackServerOptions = {}) {
    this._options = {
      port: options.port ?? 1900,
      host: options.host ?? 'localhost',
      path: options.path ?? '/melker/auth',
      timeout: options.timeout ?? 300000,
      keepAlive: options.keepAlive ?? false,
    };
  }

  /**
   * Whether the server should be kept alive after callback
   */
  get keepAlive(): boolean {
    return this._options.keepAlive;
  }

  /**
   * Start the callback server
   */
  async start(): Promise<void> {
    if (this._server) {
      throw new Error('Callback server already running');
    }

    const handler = async (req: Request): Promise<Response> => {
      const url = new URL(req.url);

      // Serve the logo image
      if (url.pathname === '/melker/logo.png') {
        return new Response(Uint8Array.from(getAsset('logo-128')), {
          headers: { ...NO_CACHE_HEADERS, 'content-type': 'image/png' },
        });
      }

      if (url.pathname !== this._options.path) {
        return new Response('Not Found', { status: 404, headers: NO_CACHE_HEADERS });
      }

      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');
      const errorDescription = url.searchParams.get('error_description');

      if (error) {
        const errorHtml = this.getErrorHtml(error, errorDescription || 'Unknown error');
        if (this._codeReject) {
          this._codeReject(new Error(`OAuth error: ${error} - ${errorDescription}`));
        }
        return new Response(errorHtml, {
          headers: { ...NO_CACHE_HEADERS, 'content-type': 'text/html' },
        });
      }

      if (!code || !state) {
        const errorHtml = this.getErrorHtml('invalid_request', 'Missing code or state parameter');
        if (this._codeReject) {
          this._codeReject(new Error('Missing code or state parameter'));
        }
        return new Response(errorHtml, {
          headers: { ...NO_CACHE_HEADERS, 'content-type': 'text/html' },
        });
      }

      if (this._codeResolve) {
        this._codeResolve({ code, state });
      }

      return new Response(this.getSuccessHtml(), {
        headers: { ...NO_CACHE_HEADERS, 'content-type': 'text/html' },
      });
    };

    this._server = Deno.serve({
      port: this._options.port,
      hostname: this._options.host,
      onListen: () => {},
    }, handler);
  }

  /**
   * Wait for authorization code from callback
   */
  waitForCode(): Promise<CallbackResult> {
    return new Promise((resolve, reject) => {
      this._codeResolve = resolve;
      this._codeReject = reject;

      this._timeoutId = setTimeout(() => {
        reject(new Error('Authentication timed out'));
      }, this._options.timeout);
    });
  }

  /**
   * Stop the callback server
   */
  async stop(): Promise<void> {
    if (this._timeoutId) {
      clearTimeout(this._timeoutId);
    }

    if (this._server) {
      await this._server.shutdown();
      this._server = undefined;
    }
  }

  /**
   * Get success HTML page
   */
  private getSuccessHtml(): string {
    return `<!DOCTYPE html>
<html>
<head>
  <title>Authentication Successful</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
      background: #1a1a2e;
    }
    .card {
      background: #16213e;
      padding: 40px 50px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      gap: 24px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    }
    .logo { width: 80px; height: 80px; }
    .content { text-align: left; }
    h1 { color: #4caf50; margin: 0 0 8px 0; font-size: 24px; }
    p { color: #a0a0a0; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <img class="logo" src="/melker/logo.png" alt="Melker">
    <div class="content">
      <h1>Authentication Successful</h1>
      <p>You may close this window and return to the terminal.</p>
    </div>
  </div>
</body>
</html>`;
  }

  /**
   * Get error HTML page
   */
  private getErrorHtml(error: string, description: string): string {
    return `<!DOCTYPE html>
<html>
<head>
  <title>Authentication Failed</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
      background: #1a1a2e;
    }
    .card {
      background: #16213e;
      padding: 40px 50px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      gap: 24px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    }
    .logo { width: 80px; height: 80px; }
    .content { text-align: left; }
    h1 { color: #f44336; margin: 0 0 8px 0; font-size: 24px; }
    p { color: #a0a0a0; margin: 0; }
    .error-code { font-family: monospace; color: #666; margin-top: 8px; }
  </style>
</head>
<body>
  <div class="card">
    <img class="logo" src="/melker/logo.png" alt="Melker">
    <div class="content">
      <h1>Authentication Failed</h1>
      <p>${description}</p>
      <p class="error-code">Error: ${error}</p>
    </div>
  </div>
</body>
</html>`;
  }
}
