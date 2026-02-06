// WebSocket server for Melker UI applications
// Provides remote access to engine state, buffer contents, and event injection

import { type MelkerEngine } from './engine.ts';
import { type Element } from './types.ts';
import { MelkerConfig } from './config/mod.ts';
import { rgbaToCss } from './components/color-utils.ts';
import { dirname, fromFileUrl, join } from 'https://deno.land/std@0.224.0/path/mod.ts';

// Get the directory containing this file for loading server UI assets
const SERVER_UI_DIR = join(dirname(fromFileUrl(import.meta.url)), 'server-ui');

export interface ServerOptions {
  port?: number;
  host?: string;
  token?: string;
  enableBufferStreaming?: boolean;
  enableEventInjection?: boolean;
}

export interface ServerMessage {
  type: string;
  data?: any;
  id?: string;
}

export interface BufferSnapshot {
  width: number;
  height: number;
  content: string[][];
  styles: any[][];
  timestamp: number;
}

export interface EngineState {
  isRunning: boolean;
  elementCount: number;
  focusedElement?: string;
  documentStats: any;
  terminalSize: { width: number; height: number };
}

/**
 * Available subscription types for server updates
 */
export type SubscriptionType =
  | 'buffer-updates'      // Real-time buffer changes
  | 'engine-state'        // Engine state changes
  | 'document-changes'    // DOM tree changes
  | 'event-stream'        // Input events and interactions
  | 'headless-updates'    // Headless mode status changes
  | 'performance-metrics' // Rendering performance data
  | 'render-notifications'// Notifications when any re-render occurs
  | 'error-logs'          // Error and warning messages
  | 'terminal-resize'     // Terminal resize events
  | 'log-stream';         // Real-time log entries

/**
 * Client subscription information
 */
interface ClientSubscription {
  socket: WebSocket;
  subscriptions: Set<SubscriptionType>;
  lastEngineState?: any;   // For engine state change detection
}

export class MelkerServer {
  private _server?: Deno.HttpServer;
  private _engine?: MelkerEngine;
  private _connections = new Set<WebSocket>();
  private _clientSubscriptions = new Map<WebSocket, ClientSubscription>();
  private _options: Required<Omit<ServerOptions, 'token'>>;
  private _isRunning = false;
  private _token: string;

  // Throttling for render notifications (30fps = 33ms)
  private _lastRenderNotification = 0;
  private _pendingRenderNotification = false;
  private _renderThrottleMs = 33;

  // Delta tracking for buffer updates
  private _lastSentBuffer: BufferSnapshot | null = null;

  constructor(options: ServerOptions = {}) {
    const config = MelkerConfig.get();
    this._options = {
      port: config.serverPort ?? 18080,
      host: config.serverHost,
      enableBufferStreaming: true,
      enableEventInjection: true,
      ...options,
    };

    // Token priority: option > config > auto-generate
    this._token = options.token ?? config.serverToken ?? this._generateToken();
  }

  /**
   * Generate a random 32-character hex token
   */
  private _generateToken(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Get the connection token
   */
  get token(): string {
    return this._token;
  }

  /**
   * Get the full connection URL including token
   */
  get connectionUrl(): string {
    const host = this._options.host || 'localhost';
    return `http://${host}:${this._options.port}/?token=${this._token}`;
  }

  /**
   * Attach a Melker engine for inspection
   */
  attachEngine(engine: MelkerEngine): void {
    this._engine = engine;
    this._broadcastEngineState();
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    if (this._isRunning) {
      throw new Error('Server is already running');
    }

    const handler = (req: Request): Response | Promise<Response> => {
      const url = new URL(req.url);

      // Validate token for all requests
      const token = url.searchParams.get('token');
      if (token !== this._token) {
        return new Response('Unauthorized: Invalid or missing token', {
          status: 401,
          headers: { 'content-type': 'text/plain' },
        });
      }

      // Handle WebSocket upgrade
      if (req.headers.get('upgrade') === 'websocket') {
        const { socket, response } = Deno.upgradeWebSocket(req);

        socket.onopen = () => {
          this._connections.add(socket);

          // Initialize client subscription
          this._clientSubscriptions.set(socket, {
            socket,
            subscriptions: new Set(),
          });

          this._sendWelcome(socket);
        };

        socket.onmessage = (event) => {
          this._handleMessage(socket, event.data);
        };

        socket.onclose = () => {
          this._connections.delete(socket);
          this._clientSubscriptions.delete(socket);
        };

        socket.onerror = (error) => {
          this._connections.delete(socket);
          this._clientSubscriptions.delete(socket);
        };

        return response;
      }

      // Serve mirror UI at root (the only UI now)
      return new Response(this._getServerUI(), {
        headers: { 'content-type': 'text/html' },
      });
    };

    this._server = Deno.serve({
      port: this._options.port,
      hostname: this._options.host,
      onListen: () => {}, // Suppress default "Listening on" message
    }, handler);

    this._isRunning = true;


  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    if (!this._isRunning) return;


    // Close all connections
    for (const socket of this._connections) {
      socket.close();
    }
    this._connections.clear();

    // Stop server
    if (this._server) {
      await this._server.shutdown();
      this._server = undefined;
    }

    this._isRunning = false;
  }

  /**
   * Check if server is running
   */
  get isRunning(): boolean {
    return this._isRunning;
  }

  /**
   * Get current engine
   */
  get engine(): MelkerEngine | undefined {
    return this._engine;
  }

  /**
   * Notify subscribers that a render has occurred
   * Throttled to max 30fps to prevent flooding
   */
  notifyRenderComplete(): void {
    const now = Date.now();
    const elapsed = now - this._lastRenderNotification;

    if (elapsed >= this._renderThrottleMs) {
      // Enough time has passed, send immediately
      this._lastRenderNotification = now;
      this._pendingRenderNotification = false;
      this._broadcastToSubscribers('render-notifications', {
        timestamp: now,
        message: 'render-complete'
      });
    } else if (!this._pendingRenderNotification) {
      // Schedule a delayed notification
      this._pendingRenderNotification = true;
      setTimeout(() => {
        if (this._pendingRenderNotification) {
          this._lastRenderNotification = Date.now();
          this._pendingRenderNotification = false;
          this._broadcastToSubscribers('render-notifications', {
            timestamp: Date.now(),
            message: 'render-complete'
          });
        }
      }, this._renderThrottleMs - elapsed);
    }
    // If pending notification exists, do nothing (coalesce into pending)
  }

  /**
   * Notify subscribers that the terminal has been resized
   */
  notifyTerminalResize(width: number, height: number): void {
    this._broadcastToSubscribers('terminal-resize', {
      timestamp: Date.now(),
      width,
      height
    });
  }

  /**
   * Broadcast a log entry to all subscribed clients
   */
  broadcastLog(entry: { level: string; message: string; source?: string; context?: Record<string, unknown>; timestamp: Date }): void {
    this._broadcastToSubscribers('log-stream', {
      level: entry.level,
      message: entry.message,
      source: entry.source,
      context: entry.context,
      timestamp: entry.timestamp.toISOString(),
    });
  }

  // Private methods

  private _sendWelcome(socket: WebSocket): void {
    const message: ServerMessage = {
      type: 'welcome',
      data: {
        version: '0.1.0',
        capabilities: {
          bufferStreaming: this._options.enableBufferStreaming,
          eventInjection: this._isEventInjectionAllowed(),
        },
        engineAttached: !!this._engine,
      },
    };
    socket.send(JSON.stringify(message));

    // Send current engine state if available
    if (this._engine) {
      this._sendEngineState(socket);
      this._sendBufferSnapshot(socket);
    }
  }

  private _handleMessage(socket: WebSocket, data: string): void {
    try {
      const message: ServerMessage = JSON.parse(data);

      switch (message.type) {
        case 'get-buffer':
          this._sendBufferSnapshot(socket);
          break;

        case 'get-engine-state':
          this._sendEngineState(socket);
          break;

        case 'get-document-tree':
          this._sendDocumentTree(socket);
          break;

        case 'inject-event':
          if (this._isEventInjectionAllowed()) {
            this._injectEvent(message.data);
          }
          break;

        case 'trigger-render':
          if (this._engine) {
            this._engine.render();
            this._sendResponse(socket, message.id, { success: true });
          }
          break;

        case 'get-element':
          this._sendElement(socket, message.data?.elementId, message.id);
          break;

        case 'get-headless-status':
          this._sendHeadlessStatus(socket, message.id);
          break;

        case 'get-terminal-output':
          this._sendTerminalOutput(socket, message.id);
          break;

        case 'clear-terminal-output':
          this._clearTerminalOutput(socket, message.id);
          break;

        case 'resize-virtual-terminal':
          this._resizeVirtualTerminal(socket, message.data, message.id);
          break;

        case 'subscribe':
          this._handleSubscription(socket, message.data?.subscriptions, message.id);
          break;

        case 'unsubscribe':
          this._handleUnsubscription(socket, message.data?.subscriptions, message.id);
          break;

        case 'list-subscriptions':
          this._sendSubscriptions(socket, message.id);
          break;

        case 'click-element-by-id':
          this._clickElementById(socket, message.data?.elementId, message.id);
          break;

        case 'trigger-tab-navigation':
          this._triggerTabNavigation(socket, message.data?.reverse, message.id);
          break;

        case 'inject-click':
          if (this._isEventInjectionAllowed()) {
            this._injectClickEvent(socket, message.data, message.id);
          } else {
            this._sendError(socket, 'Event injection is disabled (only available in headless mode)', message.id);
          }
          break;

        case 'inject-key':
          if (this._isEventInjectionAllowed()) {
            this._injectKeyEvent(socket, message.data, message.id);
          } else {
            this._sendError(socket, 'Event injection is disabled (only available in headless mode)', message.id);
          }
          break;

        case 'dispatch-named-event':
          if (this._isEventInjectionAllowed()) {
            this._dispatchNamedEvent(socket, message.data, message.id);
          } else {
            this._sendError(socket, 'Event injection is disabled (only available in headless mode)', message.id);
          }
          break;

        case 'get-element-bounds':
          this._getElementBounds(socket, message.data?.elementId, message.id);
          break;

        case 'get-element-at':
          this._getElementAt(socket, message.data, message.id);
          break;

        default:
          this._sendError(socket, `Unknown message type: ${message.type}`, message.id);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this._sendError(socket, `Failed to parse message: ${errorMessage}`, undefined);
    }
  }

  private _sendBufferSnapshot(socket: WebSocket): void {
    if (!this._engine) {
      this._sendError(socket, 'Engine not available');
      return;
    }

    try {
      const buffer = this._engine.getBuffer();

      // Validate buffer structure
      if (!buffer || !buffer.getDisplayBuffer || typeof buffer.width !== 'number' || typeof buffer.height !== 'number') {
        this._sendError(socket, 'Invalid buffer structure');
        return;
      }

      // Validate buffer dimensions
      if (buffer.width <= 0 || buffer.height <= 0) {
        this._sendError(socket, `Invalid buffer dimensions: ${buffer.width}x${buffer.height}`);
        return;
      }

      const snapshot: BufferSnapshot = {
        width: buffer.width,
        height: buffer.height,
        content: [],
        styles: [],
        timestamp: Date.now(),
      };

      // Extract buffer content and styles
      const displayBuffer = buffer.getDisplayBuffer();
      for (let y = 0; y < buffer.height; y++) {
        const contentRow: string[] = [];
        const styleRow: any[] = [];

        for (let x = 0; x < buffer.width; x++) {
          try {
            const cell = displayBuffer.getCell(x, y);
            contentRow.push(cell?.char || ' ');
            styleRow.push({
              fg: cell?.foreground ? rgbaToCss(cell.foreground) : undefined,
              bg: cell?.background ? rgbaToCss(cell.background) : undefined,
              bold: cell?.bold || false,
              width: cell?.width || 1,
              isWideCharContinuation: cell?.isWideCharContinuation || false,
            });
          } catch {
            contentRow.push(' ');
            styleRow.push({ fg: undefined, bg: undefined, bold: false, width: 1, isWideCharContinuation: false });
          }
        }

        snapshot.content.push(contentRow);
        snapshot.styles.push(styleRow);
      }

      if (snapshot.content.length === 0 || snapshot.styles.length === 0) {
        this._sendError(socket, 'Empty buffer snapshot generated');
        return;
      }

      // Try to send delta if we have a previous buffer
      const lastBuffer = this._lastSentBuffer;
      if (lastBuffer &&
          lastBuffer.width === snapshot.width &&
          lastBuffer.height === snapshot.height) {
        const delta = this._computeBufferDelta(lastBuffer, snapshot);

        // Send delta if less than 30% of cells changed (otherwise full is more efficient)
        const totalCells = snapshot.width * snapshot.height;
        const changeThreshold = totalCells * 0.3;

        if (delta.count > 0 && delta.count < changeThreshold) {
          this._lastSentBuffer = snapshot;
          socket.send(JSON.stringify({
            type: 'buffer-delta',
            data: delta,
          }));
          return;
        }
      }

      // Send RLE-compressed snapshot (much smaller for scrolling)
      this._lastSentBuffer = snapshot;
      const compressed = this._compressBufferRLE(snapshot);
      socket.send(JSON.stringify({
        type: 'buffer-snapshot-rle',
        data: compressed,
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this._sendError(socket, `Failed to get buffer snapshot: ${errorMessage}`);
    }
  }

  /**
   * RLE-compress a buffer snapshot for efficient transmission
   *
   * Format: {
   *   width, height, timestamp,
   *   styles: [...],  // style palette (indexed)
   *   rows: { "y": [[startX, runLength, char, styleIndex], ...], ... }
   * }
   *
   * Consecutive cells with same char+style are merged into runs
   */
  private _compressBufferRLE(snapshot: BufferSnapshot): {
    width: number;
    height: number;
    timestamp: number;
    styles: Array<{ f?: string; b?: string; o?: boolean; w?: number; c?: boolean }>;
    rows: Record<string, Array<[number, number, string, number]>>;
  } {
    const styleMap = new Map<string, number>();
    const styles: Array<{ f?: string; b?: string; o?: boolean; w?: number; c?: boolean }> = [];
    const rows: Record<string, Array<[number, number, string, number]>> = {};

    for (let y = 0; y < snapshot.height; y++) {
      const runs: Array<[number, number, string, number]> = [];
      let runStartX = 0;
      let runChar = '';
      let runStyleKey = '';
      let runStyleIndex = 0;
      let runLength = 0;

      for (let x = 0; x < snapshot.width; x++) {
        const char = snapshot.content[y]?.[x] || ' ';
        const cellStyle = snapshot.styles[y]?.[x];

        // Build compact style object
        const compactStyle: { f?: string; b?: string; o?: boolean; w?: number; c?: boolean } = {};
        if (cellStyle?.fg) compactStyle.f = cellStyle.fg;
        if (cellStyle?.bg) compactStyle.b = cellStyle.bg;
        if (cellStyle?.bold) compactStyle.o = true;
        if (cellStyle?.width && cellStyle.width !== 1) compactStyle.w = cellStyle.width;
        if (cellStyle?.isWideCharContinuation) compactStyle.c = true;

        const styleKey = JSON.stringify(compactStyle);

        // Get or create style index
        let styleIndex = styleMap.get(styleKey);
        if (styleIndex === undefined) {
          styleIndex = styles.length;
          styles.push(compactStyle);
          styleMap.set(styleKey, styleIndex);
        }

        // Check if this cell extends the current run
        if (runLength > 0 && char === runChar && styleKey === runStyleKey) {
          runLength++;
        } else {
          // Save previous run if exists
          if (runLength > 0) {
            runs.push([runStartX, runLength, runChar, runStyleIndex]);
          }
          // Start new run
          runStartX = x;
          runChar = char;
          runStyleKey = styleKey;
          runStyleIndex = styleIndex;
          runLength = 1;
        }
      }

      // Save final run
      if (runLength > 0) {
        runs.push([runStartX, runLength, runChar, runStyleIndex]);
      }

      rows[String(y)] = runs;
    }

    return {
      width: snapshot.width,
      height: snapshot.height,
      timestamp: snapshot.timestamp,
      styles,
      rows,
    };
  }

  /**
   * Compact delta format:
   * - styles: palette of unique style combinations (indexed)
   * - rows: { rowNum: [[x, char, styleIndex], ...] }
   *
   * Style object uses short keys: f=fg, b=bg, o=bold, w=width, c=continuation
   * Omits default values (w=1, o=false, c=false)
   */
  private _computeBufferDelta(
    oldBuffer: BufferSnapshot,
    newBuffer: BufferSnapshot
  ): {
    styles: Array<{ f?: string; b?: string; o?: boolean; w?: number; c?: boolean }>;
    rows: Record<string, Array<[number, string, number]>>;
    count: number;
  } {
    const styleMap = new Map<string, number>(); // style key -> index
    const styles: Array<{ f?: string; b?: string; o?: boolean; w?: number; c?: boolean }> = [];
    const rows: Record<string, Array<[number, string, number]>> = {};
    let count = 0;

    for (let y = 0; y < newBuffer.height; y++) {
      for (let x = 0; x < newBuffer.width; x++) {
        const oldChar = oldBuffer.content[y]?.[x];
        const newChar = newBuffer.content[y]?.[x];
        const oldStyle = oldBuffer.styles[y]?.[x];
        const newStyle = newBuffer.styles[y]?.[x];

        // Check if cell changed
        if (oldChar !== newChar ||
            oldStyle?.fg !== newStyle?.fg ||
            oldStyle?.bg !== newStyle?.bg ||
            oldStyle?.bold !== newStyle?.bold ||
            oldStyle?.width !== newStyle?.width ||
            oldStyle?.isWideCharContinuation !== newStyle?.isWideCharContinuation) {

          // Build compact style object (omit defaults)
          const compactStyle: { f?: string; b?: string; o?: boolean; w?: number; c?: boolean } = {};
          if (newStyle?.fg) compactStyle.f = newStyle.fg;
          if (newStyle?.bg) compactStyle.b = newStyle.bg;
          if (newStyle?.bold) compactStyle.o = true;
          if (newStyle?.width && newStyle.width !== 1) compactStyle.w = newStyle.width;
          if (newStyle?.isWideCharContinuation) compactStyle.c = true;

          // Get or create style index
          const styleKey = JSON.stringify(compactStyle);
          let styleIndex = styleMap.get(styleKey);
          if (styleIndex === undefined) {
            styleIndex = styles.length;
            styles.push(compactStyle);
            styleMap.set(styleKey, styleIndex);
          }

          // Add to row
          const rowKey = String(y);
          if (!rows[rowKey]) rows[rowKey] = [];
          rows[rowKey].push([x, newChar || ' ', styleIndex]);
          count++;
        }
      }
    }

    return { styles, rows, count };
  }

  private _sendEngineState(socket: WebSocket): void {
    if (!this._engine) return;

    try {
      const state: EngineState = {
        isRunning: this._engine.isRunning,
        elementCount: this._engine.document.elementCount,
        focusedElement: this._engine.document.focusedElement?.id,
        documentStats: this._engine.document.getDocumentStats(),
        terminalSize: this._engine.getTerminalSize(),
      };

      const message: ServerMessage = {
        type: 'engine-state',
        data: state,
      };
      socket.send(JSON.stringify(message));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this._sendError(socket, `Failed to get engine state: ${errorMessage}`);
    }
  }

  private _sendDocumentTree(socket: WebSocket): void {
    if (!this._engine) return;

    try {
      const tree = (this._engine.document as any).asStructuredTree ?
        (this._engine.document as any).asStructuredTree() :
        this._engine.document.asTree();
      const message: ServerMessage = {
        type: 'document-tree',
        data: { tree },
      };
      socket.send(JSON.stringify(message));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this._sendError(socket, `Failed to get document tree: ${errorMessage}`);
    }
  }

  private _sendElement(socket: WebSocket, elementId: string, messageId?: string): void {
    if (!this._engine || !elementId) {
      this._sendError(socket, 'Engine not attached or element ID missing', messageId);
      return;
    }

    try {
      const element = this._engine.document.getElementById(elementId);
      if (!element) {
        this._sendError(socket, `Element not found: ${elementId}`, messageId);
        return;
      }

      const response: ServerMessage = {
        type: 'element',
        data: {
          element: {
            id: element.id,
            type: element.type,
            props: element.props,
            children: element.children?.map(child => ({
              id: child.id,
              type: child.type,
            })),
          },
        },
        id: messageId,
      };
      socket.send(JSON.stringify(response));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this._sendError(socket, `Failed to get element: ${errorMessage}`, messageId);
    }
  }

  /**
   * Check if event injection is allowed
   * Allowed in headless mode or when MELKER_ALLOW_SERVER_INPUT is set
   */
  private _isEventInjectionAllowed(): boolean {
    if (!this._options.enableEventInjection) {
      return false;
    }

    // Always allow in headless mode
    if (this._engine?.isHeadless) {
      return true;
    }

    // Allow in non-headless mode if explicitly enabled via config
    // This enables the browser mirror to send mouse/keyboard events
    return MelkerConfig.get().serverAllowInput;
  }

  private _injectEvent(eventData: any): void {
    if (!this._engine) return;

    try {
      // Create event based on type
      const { type, ...data } = eventData;

      switch (type) {
        case 'keypress':
          this._engine.handleKeyPress({
            key: data.key || 'Enter',
            ctrlKey: data.ctrlKey || false,
            metaKey: data.metaKey || false,
            shiftKey: data.shiftKey || false,
          });
          break;

        case 'keydown':
          // For keydown events, dispatch directly through the event system
          if (this._engine.eventManager) {
            const keyEvent = {
              type: 'keydown' as const,
              key: data.key || 'Enter',
              code: data.code || data.key || 'Enter',
              ctrlKey: data.ctrlKey || false,
              metaKey: data.metaKey || false,
              shiftKey: data.shiftKey || false,
              altKey: data.altKey || false,
              timestamp: Date.now()
            };
            this._engine.eventManager.dispatchEvent(keyEvent);
          }
          break;

        case 'click':
          // Simulate mouse click if position provided
          if (data.x !== undefined && data.y !== undefined) {
            this._engine.handleMouseEvent({
              type: 'click',
              position: { x: data.x, y: data.y },
              button: data.button || 0, // 0 = left button
            });
          }
          break;

        default:
          // Unknown event type for injection
      }
    } catch (error) {
      // Failed to inject event
    }
  }

  private _injectClickEvent(socket: WebSocket, clickData: any, messageId?: string): void {
    if (!this._engine) {
      this._sendError(socket, 'Engine not attached', messageId);
      return;
    }

    try {
      const { x, y, button = 'left' } = clickData;

      if (typeof x !== 'number' || typeof y !== 'number') {
        this._sendError(socket, 'Click coordinates (x, y) must be numbers', messageId);
        return;
      }

      // Convert button string to number for engine
      const buttonNumber = button === 'right' ? 2 : button === 'middle' ? 1 : 0;

      // Inject click event using existing method
      this._injectEvent({
        type: 'click',
        x,
        y,
        button: buttonNumber
      });

      this._sendResponse(socket, messageId, {
        success: true,
        message: `Click injected at (${x}, ${y}) with ${button} button`
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this._sendError(socket, `Failed to inject click: ${errorMessage}`, messageId);
    }
  }

  private _injectKeyEvent(socket: WebSocket, keyData: any, messageId?: string): void {
    if (!this._engine) {
      this._sendError(socket, 'Engine not attached', messageId);
      return;
    }

    try {
      const {
        key,
        code,
        type = 'keydown',
        ctrlKey = false,
        altKey = false,
        shiftKey = false,
        metaKey = false
      } = keyData;

      if (!key) {
        this._sendError(socket, 'Key data must include "key" property', messageId);
        return;
      }

      // Support both keydown and keyup events
      if (type === 'keyup') {
        // For keyup events, we can use the existing keydown handler
        // Most Melker components only care about keydown anyway
        this._injectEvent({
          type: 'keydown',
          key,
          code: code || key,
          ctrlKey,
          altKey,
          shiftKey,
          metaKey
        });
      } else {
        // Default to keydown
        this._injectEvent({
          type: 'keydown',
          key,
          code: code || key,
          ctrlKey,
          altKey,
          shiftKey,
          metaKey
        });
      }

      this._sendResponse(socket, messageId, {
        success: true,
        message: `Key event "${key}" injected (${type})`
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this._sendError(socket, `Failed to inject key event: ${errorMessage}`, messageId);
    }
  }

  private _dispatchNamedEvent(socket: WebSocket, eventData: any, messageId?: string): void {
    if (!this._engine) {
      this._sendError(socket, 'Engine not attached', messageId);
      return;
    }

    try {
      const { name, detail } = eventData;

      if (!name || typeof name !== 'string') {
        this._sendError(socket, 'Event name must be a non-empty string', messageId);
        return;
      }

      this._engine.dispatchNamedEvent(name, detail);

      this._sendResponse(socket, messageId, {
        success: true,
        message: `Named event "${name}" dispatched`
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this._sendError(socket, `Failed to dispatch named event: ${errorMessage}`, messageId);
    }
  }

  private _getElementBounds(socket: WebSocket, elementId: string, messageId?: string): void {
    if (!this._engine) {
      this._sendError(socket, 'Engine not attached', messageId);
      return;
    }

    if (!elementId) {
      this._sendError(socket, 'Element ID is required', messageId);
      return;
    }

    try {
      const bounds = this._engine.getElementBounds(elementId);

      if (bounds) {
        this._sendResponse(socket, messageId, {
          elementId,
          bounds: {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height
          }
        });
      } else {
        this._sendResponse(socket, messageId, {
          elementId,
          bounds: null,
          message: 'Element not found or not rendered'
        });
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this._sendError(socket, `Failed to get element bounds: ${errorMessage}`, messageId);
    }
  }

  private _getElementAt(socket: WebSocket, data: any, messageId?: string): void {
    if (!this._engine) {
      this._sendError(socket, 'Engine not attached', messageId);
      return;
    }

    try {
      const { x, y } = data || {};

      if (typeof x !== 'number' || typeof y !== 'number') {
        this._sendError(socket, 'Coordinates (x, y) must be numbers', messageId);
        return;
      }

      const result = this._engine.getElementAt(x, y);

      this._sendResponse(socket, messageId, {
        x,
        y,
        element: result
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this._sendError(socket, `Failed to get element at coordinates: ${errorMessage}`, messageId);
    }
  }

  private _clickElementById(socket: WebSocket, elementId: string, messageId?: string): void {
    if (!this._engine) {
      this._sendError(socket, 'Engine not attached', messageId);
      return;
    }

    if (!elementId) {
      this._sendError(socket, 'Element ID is required', messageId);
      return;
    }

    try {
      this._engine.clickElementById(elementId);
      this._sendResponse(socket, messageId, {
        success: true,
        message: `Clicked element: ${elementId}`,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this._sendError(socket, `Failed to click element: ${errorMessage}`, messageId);
    }
  }

  private _triggerTabNavigation(socket: WebSocket, reverse?: boolean, messageId?: string): void {
    if (!this._engine) {
      this._sendError(socket, 'Engine not attached', messageId);
      return;
    }

    try {
      // Access the private method through any type casting
      (this._engine as any)._handleTabNavigation(reverse || false);
      this._sendResponse(socket, messageId, {
        success: true,
        message: `Tab navigation triggered (reverse: ${reverse || false})`,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this._sendError(socket, `Failed to trigger tab navigation: ${errorMessage}`, messageId);
    }
  }

  private _sendHeadlessStatus(socket: WebSocket, messageId?: string): void {
    if (!this._engine) {
      this._sendError(socket, 'Engine not attached', messageId);
      return;
    }

    const status = {
      isHeadless: this._engine.isHeadless,
      headlessManager: !!this._engine.headlessManager,
      terminalSize: this._engine.getTerminalSize(),
      hasTerminalOutput: this._engine.headlessManager ? true : false,
    };

    const response: ServerMessage = {
      type: 'headless-status',
      data: status,
      id: messageId,
    };
    socket.send(JSON.stringify(response));
  }

  private _sendTerminalOutput(socket: WebSocket, messageId?: string): void {
    if (!this._engine?.headlessManager) {
      this._sendError(socket, 'Not running in headless mode', messageId);
      return;
    }

    try {
      const output = this._engine.headlessManager.getTerminalOutput();
      const response: ServerMessage = {
        type: 'terminal-output',
        data: { output },
        id: messageId,
      };
      socket.send(JSON.stringify(response));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this._sendError(socket, `Failed to get terminal output: ${errorMessage}`, messageId);
    }
  }

  private _clearTerminalOutput(socket: WebSocket, messageId?: string): void {
    if (!this._engine?.headlessManager) {
      this._sendError(socket, 'Not running in headless mode', messageId);
      return;
    }

    try {
      this._engine.headlessManager.clearTerminalOutput();
      this._sendResponse(socket, messageId, { success: true });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this._sendError(socket, `Failed to clear terminal output: ${errorMessage}`, messageId);
    }
  }

  private _resizeVirtualTerminal(socket: WebSocket, data: any, messageId?: string): void {
    if (!this._engine?.headlessManager) {
      this._sendError(socket, 'Not running in headless mode', messageId);
      return;
    }

    try {
      const { width, height } = data;
      if (typeof width !== 'number' || typeof height !== 'number') {
        this._sendError(socket, 'Width and height must be numbers', messageId);
        return;
      }

      this._engine.headlessManager.resizeTerminal(width, height);
      this._sendResponse(socket, messageId, {
        success: true,
        newSize: { width, height },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this._sendError(socket, `Failed to resize terminal: ${errorMessage}`, messageId);
    }
  }

  private _sendResponse(socket: WebSocket, messageId?: string, data?: any): void {
    const message: ServerMessage = {
      type: 'response',
      data,
      id: messageId,
    };
    socket.send(JSON.stringify(message));
  }

  private _sendError(socket: WebSocket, error: string, messageId?: string): void {
    const message: ServerMessage = {
      type: 'error',
      data: { error },
      id: messageId,
    };
    socket.send(JSON.stringify(message));
  }

  private _broadcastEngineState(): void {
    for (const socket of this._connections) {
      this._sendEngineState(socket);
    }
  }

  private _startBufferStreaming(): void {
    // No longer needed - we use render notifications instead
  }

  /**
   * Generate HTML for the server web UI
   * Features: terminal mirror, element inspector, log viewer, event injection
   * Layout: Full-width terminal mirror with tabbed panels at bottom
   */
  private _getServerUI(): string {
    // Read the separate HTML, CSS, and JS files and combine them
    const css = Deno.readTextFileSync(join(SERVER_UI_DIR, 'index.css'));
    const html = Deno.readTextFileSync(join(SERVER_UI_DIR, 'index.html'));
    const js = Deno.readTextFileSync(join(SERVER_UI_DIR, 'index.js'));

    return `<!DOCTYPE html>
<html>
<head>
  <title>Melker</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
${css}
  </style>
</head>
<body>
${html}
  <script>
${js}
  </script>
</body>
</html>`;
  }

  /**
   * Handle client subscription to update types
   */
  private _handleSubscription(socket: WebSocket, subscriptions: SubscriptionType[], requestId?: string): void {
    const client = this._clientSubscriptions.get(socket);
    if (!client) return;

    if (subscriptions && Array.isArray(subscriptions)) {
      subscriptions.forEach(sub => client.subscriptions.add(sub));
      this._sendResponse(socket, requestId, {
        success: true,
        message: `Subscribed to: ${subscriptions.join(', ')}`,
        activeSubscriptions: Array.from(client.subscriptions)
      });

      // Send initial data for subscribed types
      subscriptions.forEach(sub => {
        switch (sub) {
          case 'buffer-updates':
            this._sendBufferSnapshot(socket);
            break;
          case 'engine-state':
            this._sendEngineState(socket);
            break;
          case 'headless-updates':
            this._sendHeadlessStatus(socket);
            break;
        }
      });
    } else {
      this._sendError(socket, 'Invalid subscriptions array', requestId);
    }
  }

  /**
   * Handle client unsubscription from update types
   */
  private _handleUnsubscription(socket: WebSocket, subscriptions: SubscriptionType[], requestId?: string): void {
    const client = this._clientSubscriptions.get(socket);
    if (!client) return;

    if (subscriptions && Array.isArray(subscriptions)) {
      subscriptions.forEach(sub => client.subscriptions.delete(sub));
      this._sendResponse(socket, requestId, {
        success: true,
        message: `Unsubscribed from: ${subscriptions.join(', ')}`,
        activeSubscriptions: Array.from(client.subscriptions)
      });
    } else {
      this._sendError(socket, 'Invalid subscriptions array', requestId);
    }
  }

  /**
   * Send current subscriptions for a client
   */
  private _sendSubscriptions(socket: WebSocket, requestId?: string): void {
    const client = this._clientSubscriptions.get(socket);
    if (!client) return;

    this._sendResponse(socket, requestId, {
      subscriptions: Array.from(client.subscriptions),
      availableTypes: [
        'buffer-updates',
        'engine-state',
        'document-changes',
        'event-stream',
        'headless-updates',
        'performance-metrics',
        'render-notifications',
        'terminal-resize',
        'error-logs',
        'log-stream'
      ]
    });
  }

  /**
   * Broadcast update to subscribed clients only
   */
  private _broadcastToSubscribers(subscriptionType: SubscriptionType, data: any): void {
    this._clientSubscriptions.forEach((client) => {
      if (client.subscriptions.has(subscriptionType)) {
        try {
          client.socket.send(JSON.stringify({
            type: `${subscriptionType}-update`,
            timestamp: Date.now(),
            data
          }));
        } catch (error) {
          // Failed to send update to subscriber
        }
      }
    });
  }

}

// Utility function to create and start server
export function createServer(options?: ServerOptions): MelkerServer {
  return new MelkerServer(options);
}

// Check if server should be enabled
export function isServerEnabled(): boolean {
  const config = MelkerConfig.get();
  return !!(config.serverEnabled || config.serverPort !== undefined);
}

// Global server instance for logging integration
let globalServer: MelkerServer | undefined;

/**
 * Set the global server instance (called by engine when starting)
 */
export function setGlobalServer(server: MelkerServer | undefined): void {
  globalServer = server;
}

/**
 * Get the global server instance (used by logging system)
 */
export function getGlobalServer(): MelkerServer | undefined {
  return globalServer;
}