// WebSocket debug server for Melker UI applications
// Provides remote access to engine state, buffer contents, and event injection

import { type MelkerEngine } from './engine.ts';
import { type Element } from './types.ts';
import { isRunningHeadless } from './headless.ts';
import { MelkerConfig } from './config/mod.ts';

export interface DebugServerOptions {
  port?: number;
  host?: string;
  enableBufferStreaming?: boolean;
  enableEventInjection?: boolean;
}

export interface DebugMessage {
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
 * Available subscription types for debug server updates
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

export class MelkerDebugServer {
  private _server?: Deno.HttpServer;
  private _engine?: MelkerEngine;
  private _connections = new Set<WebSocket>();
  private _clientSubscriptions = new Map<WebSocket, ClientSubscription>();
  private _options: Required<DebugServerOptions>;
  private _isRunning = false;

  // Throttling for render notifications (30fps = 33ms)
  private _lastRenderNotification = 0;
  private _pendingRenderNotification = false;
  private _renderThrottleMs = 33;

  // Delta tracking for buffer updates
  private _lastSentBuffer: BufferSnapshot | null = null;

  constructor(options: DebugServerOptions = {}) {
    const config = MelkerConfig.get();
    this._options = {
      port: config.debugPort ?? 18080,
      host: config.debugHost,
      enableBufferStreaming: true,
      enableEventInjection: true,
      ...options,
    };
  }

  /**
   * Attach a Melker engine to debug
   */
  attachEngine(engine: MelkerEngine): void {
    this._engine = engine;
    this._broadcastEngineState();
  }

  /**
   * Start the debug server
   */
  async start(): Promise<void> {
    if (this._isRunning) {
      throw new Error('Debug server is already running');
    }

    const handler = (req: Request): Response | Promise<Response> => {
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

      // Serve HTML content based on URL path
      const url = new URL(req.url);
      const path = url.pathname;

      if (path === '/mirror') {
        // Serve HTML-based mirror view
        return new Response(this._getMirrorHTML(), {
          headers: { 'content-type': 'text/html' },
        });
      } else {
        // Serve simple debug UI (default)
        return new Response(this._getDebugUI(), {
          headers: { 'content-type': 'text/html' },
        });
      }
    };

    this._server = Deno.serve({
      port: this._options.port,
      hostname: this._options.host,
      onListen: () => {}, // Suppress default "Listening on" message
    }, handler);

    this._isRunning = true;


  }

  /**
   * Stop the debug server
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
    const message: DebugMessage = {
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
      const message: DebugMessage = JSON.parse(data);

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
              fg: cell?.foreground,
              bg: cell?.background,
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

      const message: DebugMessage = {
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
      const message: DebugMessage = {
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

      const response: DebugMessage = {
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
   * Allowed in headless mode or when MELKER_ALLOW_REMOTE_INPUT is set
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
    return MelkerConfig.get().debugAllowRemoteInput;
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

    const response: DebugMessage = {
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
      const response: DebugMessage = {
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
    const message: DebugMessage = {
      type: 'response',
      data,
      id: messageId,
    };
    socket.send(JSON.stringify(message));
  }

  private _sendError(socket: WebSocket, error: string, messageId?: string): void {
    const message: DebugMessage = {
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

  private _getDebugUI(): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <title>Melker Debug Console</title>
  <style>
    body { font-family: monospace; margin: 20px; background: #1e1e1e; color: #fff; }
    .container { max-width: 1200px; margin: 0 auto; }
    .section { margin-bottom: 20px; padding: 15px; background: #2d2d2d; border-radius: 5px; }
    .terminal {
      background: #000;
      color: #fff;
      padding: 10px;
      font-family: 'Courier New', monospace;
      font-size: 12px;
      line-height: 1.2;
      border-radius: 3px;
      overflow: auto;
      white-space: pre;
    }
    .controls { margin-bottom: 10px; }
    button {
      background: #007acc;
      color: white;
      border: none;
      padding: 8px 16px;
      margin-right: 10px;
      border-radius: 3px;
      cursor: pointer;
    }
    button:hover { background: #005a9e; }
    .status {
      padding: 5px 10px;
      border-radius: 3px;
      display: inline-block;
      margin-left: 10px;
    }
    .connected { background: #4caf50; }
    .disconnected { background: #f44336; }
    input {
      background: #3c3c3c;
      color: white;
      border: 1px solid #555;
      padding: 5px;
      border-radius: 3px;
    }
    .tree { white-space: pre-wrap; font-family: monospace; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🐛 Melker Debug Console</h1>

    <div class="section">
      <h3>Connection Status</h3>
      <div class="controls">
        <button onclick="connect()">Connect</button>
        <button onclick="disconnect()">Disconnect</button>
        <span id="status" class="status disconnected">Disconnected</span>
      </div>
    </div>

    <div class="section">
      <h3>Engine State</h3>
      <div class="controls">
        <button onclick="getEngineState()">Refresh State</button>
        <button onclick="triggerRender()">Trigger Render</button>
      </div>
      <div id="engineState">No data</div>
    </div>

    <div class="section">
      <h3>Terminal Buffer</h3>
      <div class="controls">
        <button onclick="getBuffer()">Refresh Buffer</button>
        <label>
          <input type="checkbox" id="autoRefresh" onchange="toggleAutoRefresh()"> Auto-refresh
        </label>
      </div>
      <div class="terminal" id="buffer">No data</div>
    </div>

    <div class="section">
      <h3>Document Tree</h3>
      <div class="controls">
        <button onclick="getDocumentTree()">Refresh Tree</button>
      </div>
      <div class="tree" id="documentTree">No data</div>
    </div>

    <div class="section">
      <h3>Event Injection</h3>
      <div class="controls">
        <input type="text" id="keyInput" placeholder="Key (e.g., 'Enter', 'a')" />
        <button onclick="injectKey()">Inject Key</button>
        <br><br>
        <input type="number" id="clickX" placeholder="X" style="width: 60px;" />
        <input type="number" id="clickY" placeholder="Y" style="width: 60px;" />
        <button onclick="injectClick()">Inject Click</button>
      </div>
    </div>

    <div class="section">
      <h3>Headless Mode</h3>
      <div class="controls">
        <button onclick="getHeadlessStatus()">Check Headless Status</button>
        <button onclick="getTerminalOutput()">Get Terminal Output</button>
        <button onclick="clearTerminalOutput()">Clear Terminal Output</button>
        <br><br>
        <input type="number" id="resizeWidth" placeholder="Width" style="width: 60px;" />
        <input type="number" id="resizeHeight" placeholder="Height" style="width: 60px;" />
        <button onclick="resizeVirtualTerminal()">Resize Virtual Terminal</button>
      </div>
      <div id="headlessStatus">No headless data</div>
      <div class="terminal" id="terminalOutput">No terminal output</div>
    </div>
  </div>

  <script>
    let ws = null;
    let autoRefresh = false;

    function connect() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      ws = new WebSocket(\`\${protocol}//\${host}\`);

      ws.onopen = () => {
        document.getElementById('status').textContent = 'Connected';
        document.getElementById('status').className = 'status connected';
      };

      ws.onclose = () => {
        document.getElementById('status').textContent = 'Disconnected';
        document.getElementById('status').className = 'status disconnected';
        ws = null;
      };

      ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        handleMessage(message);
      };
    }

    function disconnect() {
      if (ws) {
        ws.close();
      }
    }

    function send(message) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    }

    function handleMessage(message) {
      switch (message.type) {
        case 'buffer-snapshot':
          displayBuffer(message.data);
          break;
        case 'engine-state':
          displayEngineState(message.data);
          break;
        case 'document-tree':
          displayDocumentTree(message.data.tree);
          break;
        case 'headless-status':
          displayHeadlessStatus(message.data);
          break;
        case 'terminal-output':
          displayTerminalOutput(message.data.output);
          break;
      }
    }

    function displayBuffer(snapshot) {
      const buffer = document.getElementById('buffer');
      let content = '';
      for (let y = 0; y < snapshot.height; y++) {
        for (let x = 0; x < snapshot.width; x++) {
          content += snapshot.content[y][x] || ' ';
        }
        content += '\\n';
      }
      buffer.textContent = content;
    }

    function displayEngineState(state) {
      document.getElementById('engineState').innerHTML = \`
        <strong>Running:</strong> \${state.isRunning}<br>
        <strong>Elements:</strong> \${state.elementCount}<br>
        <strong>Focused:</strong> \${state.focusedElement || 'none'}<br>
        <strong>Terminal:</strong> \${state.terminalSize.width}×\${state.terminalSize.height}
      \`;
    }

    function displayDocumentTree(tree) {
      document.getElementById('documentTree').textContent = tree;
    }

    function displayHeadlessStatus(status) {
      document.getElementById('headlessStatus').innerHTML = \`
        <strong>Headless Mode:</strong> \${status.isHeadless}<br>
        <strong>Manager Available:</strong> \${status.headlessManager}<br>
        <strong>Terminal Size:</strong> \${status.terminalSize.width}×\${status.terminalSize.height}<br>
        <strong>Has Output:</strong> \${status.hasTerminalOutput}
      \`;
    }

    function displayTerminalOutput(output) {
      const terminalDiv = document.getElementById('terminalOutput');
      terminalDiv.textContent = output.join('');
    }

    function getEngineState() {
      send({ type: 'get-engine-state' });
    }

    function getBuffer() {
      send({ type: 'get-buffer' });
    }

    function getDocumentTree() {
      send({ type: 'get-document-tree' });
    }

    function triggerRender() {
      send({ type: 'trigger-render' });
    }

    function injectKey() {
      const key = document.getElementById('keyInput').value;
      if (key) {
        send({ type: 'inject-event', data: { type: 'keypress', key } });
      }
    }

    function injectClick() {
      const x = parseInt(document.getElementById('clickX').value);
      const y = parseInt(document.getElementById('clickY').value);
      if (!isNaN(x) && !isNaN(y)) {
        send({ type: 'inject-event', data: { type: 'click', x, y } });
      }
    }

    function getHeadlessStatus() {
      send({ type: 'get-headless-status' });
    }

    function getTerminalOutput() {
      send({ type: 'get-terminal-output' });
    }

    function clearTerminalOutput() {
      send({ type: 'clear-terminal-output' });
    }

    function resizeVirtualTerminal() {
      const width = parseInt(document.getElementById('resizeWidth').value);
      const height = parseInt(document.getElementById('resizeHeight').value);
      if (!isNaN(width) && !isNaN(height)) {
        send({ type: 'resize-virtual-terminal', data: { width, height } });
      }
    }

    function toggleAutoRefresh() {
      autoRefresh = document.getElementById('autoRefresh').checked;
      if (autoRefresh) {
        setInterval(() => {
          if (autoRefresh && ws) {
            getBuffer();
            getEngineState();
          }
        }, 200);
      }
    }

    // Auto-connect on load
    connect();
  </script>
</body>
</html>`;
  }

  /**
   * Generate HTML for the mirror view interface
   */
  private _getMirrorHTML(): string {
    return `<!DOCTYPE html>
<html>
<head>
  <title>Melker UI Mirror</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
      background: #1e1e1e;
      color: #d4d4d4;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .header {
      background: #2d2d30;
      padding: 10px 15px;
      border-bottom: 1px solid #3e3e42;
      display: flex;
      justify-content: space-between;
      align-items: center;
      z-index: 100;
    }
    .title { font-size: 16px; font-weight: bold; color: #cccccc; }
    .controls { display: flex; gap: 10px; align-items: center; }
    .status-indicator {
      width: 12px; height: 12px; border-radius: 50%;
      background: #f44336; transition: background 0.3s;
    }
    .status-indicator.connected { background: #4caf50; }
    .main-content {
      flex: 1;
      display: grid;
      grid-template-columns: 1fr 300px;
      grid-template-rows: 1fr 200px;
      overflow: hidden;
    }
    .log-panel {
      grid-column: 1 / -1;
      background: #1e1e1e;
      border-top: 1px solid #3e3e42;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .log-header {
      background: #2d2d30;
      padding: 6px 12px;
      border-bottom: 1px solid #3e3e42;
      font-size: 12px;
      font-weight: 600;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .log-content {
      flex: 1;
      overflow: auto;
      font-family: 'Cascadia Code', 'Fira Code', monospace;
      font-size: 11px;
      line-height: 1.4;
      padding: 4px 8px;
    }
    .log-entry {
      padding: 2px 4px;
      border-bottom: 1px solid #2d2d30;
    }
    .log-entry:hover {
      background: #2a2d2e;
    }
    .log-timestamp {
      color: #6a9955;
      margin-right: 8px;
    }
    .log-level {
      display: inline-block;
      width: 50px;
      font-weight: bold;
      margin-right: 8px;
    }
    .log-level.DEBUG { color: #569cd6; }
    .log-level.INFO { color: #4ec9b0; }
    .log-level.WARN { color: #dcdcaa; }
    .log-level.ERROR { color: #f14c4c; }
    .log-level.FATAL { color: #ff0000; }
    .log-source {
      color: #ce9178;
      margin-right: 8px;
    }
    .log-message {
      color: #d4d4d4;
    }
    .log-context {
      color: #808080;
      margin-left: 8px;
      font-size: 10px;
    }
    .mirror-view {
      background: #000;
      position: relative;
      overflow: auto;
      border-right: 1px solid #3e3e42;
    }
    .terminal-container {
      font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
      font-size: 14px;
      line-height: 1.2;
      padding: 10px;
      white-space: pre;
      cursor: text;
      user-select: text;
      position: relative;
      outline: none;
      border: 2px solid transparent;
    }
    .terminal-container:focus {
      border-color: #0078d4;
      box-shadow: 0 0 4px rgba(0, 120, 212, 0.3);
    }
    .terminal-container.interactive {
      background: #000020;
    }
    .terminal-char {
      display: inline-block;
      min-width: 1ch;
    }
    .inspector-panel {
      background: #252526;
      border-left: 1px solid #3e3e42;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .inspector-header {
      background: #2d2d30;
      padding: 8px 12px;
      border-bottom: 1px solid #3e3e42;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .inspector-content {
      flex: 1;
      overflow: auto;
      padding: 10px;
      font-size: 12px;
    }
    .tree-node {
      margin: 2px 0;
      padding: 2px 0;
      cursor: pointer;
      user-select: none;
    }
    .tree-node:hover {
      background: #2a2d2e;
    }
    .tree-node.selected {
      background: #094771;
      color: #fff;
    }
    .tree-node.focused {
      background: #1e3a8a;
      color: #fff;
    }
    .tree-indent {
      display: inline-block;
      width: 16px;
    }
    .tree-icon {
      display: inline-block;
      width: 12px;
      text-align: center;
      margin-right: 4px;
      font-size: 10px;
      cursor: pointer;
      user-select: none;
    }
    .tree-icon:hover {
      color: #569cd6;
    }
    .tree-children {
      display: block;
    }
    .tree-children.collapsed {
      display: none;
    }
    .tree-label {
      color: #569cd6;
    }
    .tree-props {
      color: #9cdcfe;
      margin-left: 8px;
      font-size: 11px;
    }
    .element-details {
      background: #1e1e1e;
      border: 1px solid #3e3e42;
      border-radius: 4px;
      margin: 8px 0;
      padding: 8px;
    }
    .detail-label {
      color: #cccccc;
      font-weight: 600;
      margin-bottom: 4px;
    }
    .detail-value {
      color: #d4d4d4;
      font-family: monospace;
      font-size: 11px;
      white-space: pre-wrap;
      background: #2d2d30;
      padding: 4px 6px;
      border-radius: 3px;
      margin: 2px 0;
    }
    .highlight-overlay {
      position: absolute;
      pointer-events: none;
      background: rgba(255, 255, 0, 0.3);
      border: 2px solid #ffff00;
      z-index: 50;
    }
    button {
      background: #0e639c;
      color: white;
      border: none;
      padding: 6px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 11px;
    }
    button:hover { background: #1177bb; }
    button:disabled { background: #666; cursor: not-allowed; }
    .toolbar {
      display: flex;
      gap: 8px;
      align-items: center;
      padding: 8px;
      background: #2d2d30;
      border-bottom: 1px solid #3e3e42;
    }
    .search-box {
      background: #3c3c3c;
      border: 1px solid #555;
      color: #d4d4d4;
      padding: 4px 8px;
      border-radius: 3px;
      font-size: 11px;
      width: 150px;
    }
    .coordinates {
      color: #cccccc;
      font-size: 11px;
      margin-left: auto;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="title">🖥️ Melker UI Mirror</div>
    <div class="controls">
      <div class="status-indicator" id="statusIndicator"></div>
      <span id="statusText">Disconnected</span>
    </div>
  </div>

  <div class="main-content">
    <div class="mirror-view">
      <div class="toolbar">
        <button onclick="refreshView()">⟳ Refresh</button>
        <span style="color: #4ec9b0; font-size: 11px;">Push updates enabled</span>
        <input type="text" class="search-box" placeholder="Search elements..."
               onkeyup="searchElements(this.value)">
        <div class="coordinates" id="mouseCoords">x: -, y: -</div>
      </div>
      <div class="terminal-container" id="terminalView"
           onmousemove="updateMouseCoords(event)"
           onclick="handleTerminalClick(event)"
           oncontextmenu="handleTerminalRightClick(event)"
           tabindex="0"
           onkeydown="handleKeyDown(event)"
           onkeyup="handleKeyUp(event)"
           onfocus="terminalFocused()"
           onblur="terminalBlurred()">
        <div id="terminalContent">Connecting...</div>
        <div class="highlight-overlay" id="highlight" style="display: none;"></div>
      </div>
    </div>

    <div class="inspector-panel">
      <div class="inspector-header">Element Inspector</div>
      <div class="inspector-content">
        <div class="element-details">
          <div class="detail-label">Document Tree</div>
          <div id="documentTree" style="font-family: monospace; font-size: 11px; line-height: 1.4;">
            Loading...
          </div>
        </div>

        <div class="element-details" id="selectedElementDetails" style="display: none;">
          <div class="detail-label">Selected Element</div>
          <div class="detail-value" id="elementType"></div>
          <div class="detail-value" id="elementProps"></div>
          <div class="detail-value" id="elementBounds"></div>
        </div>
      </div>
    </div>

    <div class="log-panel">
      <div class="log-header">
        <span>Log Output</span>
        <div style="display: flex; gap: 8px; align-items: center;">
          <select id="logLevelFilter" onchange="filterLogs()" style="background: #3c3c3c; color: #d4d4d4; border: 1px solid #555; padding: 2px 6px; font-size: 11px;">
            <option value="DEBUG">DEBUG+</option>
            <option value="INFO" selected>INFO+</option>
            <option value="WARN">WARN+</option>
            <option value="ERROR">ERROR+</option>
          </select>
          <button onclick="clearLogs()" style="padding: 2px 8px; font-size: 11px;">Clear</button>
        </div>
      </div>
      <div class="log-content" id="logContent">
        <div style="color: #808080; padding: 8px;">Waiting for log entries...</div>
      </div>
    </div>
  </div>

  <script>
    let ws = null;
    let currentBuffer = null;
    let documentTree = null;
    let selectedElement = null;
    let focusedElement = null;
    let connectionRetryCount = 0;
    let maxRetries = 10;
    let eventInjectionEnabled = false;
    let collapsedNodes = new Set(); // Track collapsed nodes by ID
    let logEntries = []; // Store log entries
    const maxLogEntries = 500; // Maximum log entries to keep
    const logLevels = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, FATAL: 4 };
    let pendingBufferRequest = false; // Prevent duplicate buffer requests

    // WebSocket connection management
    function connect() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = \`\${protocol}//\${window.location.host}\`;

      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        connectionRetryCount = 0;
        updateConnectionStatus(true);

        // Subscribe to render notifications (push-based updates, no polling needed)
        subscribe(['render-notifications', 'engine-state', 'terminal-resize', 'log-stream']);

        // Get initial data only once
        refreshView();
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          handleMessage(message);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };

      ws.onclose = () => {
        updateConnectionStatus(false);
        stopAutoRefresh();

        // Retry connection with exponential backoff
        if (connectionRetryCount < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, connectionRetryCount), 10000);
          connectionRetryCount++;
          setTimeout(connect, delay);
        } else {
          console.error('Max connection retries reached');
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        updateConnectionStatus(false);
      };
    }

    function handleMessage(message) {
      // Message received: message.type

      switch (message.type) {
        case 'buffer-snapshot':
          pendingBufferRequest = false;
          if (message.data) {
            currentBuffer = message.data;
            renderTerminalView();
          }
          break;
        case 'buffer-snapshot-rle':
          pendingBufferRequest = false;
          if (message.data) {
            currentBuffer = decodeRLESnapshot(message.data);
            renderTerminalView();
          }
          break;
        case 'buffer-delta':
          pendingBufferRequest = false;
          if (message.data && currentBuffer) {
            applyBufferDelta(message.data);
            renderTerminalView();
          }
          break;
        case 'document-tree':
          documentTree = message.data;
          renderDocumentTree();
          break;
        case 'engine-state':
          if (message.data && message.data.focusedElementId) {
            focusedElement = message.data.focusedElementId;
            highlightFocusedElement();
          }
          break;
        case 'render-notifications-update':
          // Request buffer only if not already pending (prevents duplicate requests)
          if (!pendingBufferRequest) {
            pendingBufferRequest = true;
            send({ type: 'get-buffer' });
          }
          break;
        case 'terminal-resize-update':
          // Terminal resize detected
          // Refresh the view when terminal is resized
          send({ type: 'get-buffer' });
          send({ type: 'get-document-tree' });
          break;
        case 'log-stream-update':
          // Log entry received from server
          if (message.data) {
            addLogEntry(message.data);
          }
          break;
        case 'welcome':
          // Server welcome received
          eventInjectionEnabled = message.data?.capabilities?.eventInjection || false;
          // Event injection status updated
          break;
        case 'response':
          // Server response received
          break;
        case 'error':
          console.error('Server error:', message.data);
          break;
        default:
          // Unknown message type received
          break;
      }
    }

    function send(message) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
        return true;
      } else {
        // WebSocket not connected, cannot send message
        return false;
      }
    }

    function subscribe(types) {
      if (send({ type: 'subscribe', data: { subscriptions: types } })) {
        // Subscribed to update types
      }
    }

    function refreshView() {
      if (ws && ws.readyState === WebSocket.OPEN) {
        pendingBufferRequest = true;
        send({ type: 'get-buffer' });
        send({ type: 'get-document-tree' });
        send({ type: 'get-engine-state' });
        return true;
      }
      return false;
    }

    function applyBufferDelta(delta) {
      // Apply compact delta: { styles: [...], rows: { y: [[x, char, styleIdx], ...] } }
      if (!delta.styles || !delta.rows || !currentBuffer) return;

      const styles = delta.styles;
      for (const [rowStr, cells] of Object.entries(delta.rows)) {
        const y = parseInt(rowStr, 10);
        if (y >= currentBuffer.height) continue;

        for (const cell of cells) {
          const [x, char, styleIdx] = cell;
          if (x >= currentBuffer.width) continue;

          const style = styles[styleIdx] || {};
          currentBuffer.content[y][x] = char;
          currentBuffer.styles[y][x] = {
            fg: style.f,
            bg: style.b,
            bold: style.o || false,
            width: style.w || 1,
            isWideCharContinuation: style.c || false
          };
        }
      }
    }

    function decodeRLESnapshot(compressed) {
      // Decode RLE-compressed snapshot: { styles: [...], rows: { y: [[startX, length, char, styleIdx], ...] } }
      const { width, height, timestamp, styles, rows } = compressed;

      // Initialize empty buffer
      const content = [];
      const stylesArr = [];
      for (let y = 0; y < height; y++) {
        content.push(new Array(width).fill(' '));
        stylesArr.push(new Array(width).fill(null).map(() => ({
          fg: undefined, bg: undefined, bold: false, width: 1, isWideCharContinuation: false
        })));
      }

      // Decode RLE runs
      for (const [rowStr, runs] of Object.entries(rows)) {
        const y = parseInt(rowStr, 10);
        if (y >= height) continue;

        for (const run of runs) {
          const [startX, runLength, char, styleIdx] = run;
          const style = styles[styleIdx] || {};

          for (let i = 0; i < runLength && startX + i < width; i++) {
            const x = startX + i;
            content[y][x] = char;
            stylesArr[y][x] = {
              fg: style.f,
              bg: style.b,
              bold: style.o || false,
              width: style.w || 1,
              isWideCharContinuation: style.c || false
            };
          }
        }
      }

      return { width, height, content, styles: stylesArr, timestamp };
    }

    function updateConnectionStatus(connected) {
      const indicator = document.getElementById('statusIndicator');
      const text = document.getElementById('statusText');

      if (connected) {
        indicator.classList.add('connected');
        text.textContent = 'Connected';
      } else {
        indicator.classList.remove('connected');
        text.textContent = 'Disconnected';
      }
    }

    function renderTerminalView() {
      const terminalContent = document.getElementById('terminalContent');
      if (!terminalContent) {
        console.error('terminalContent element not found');
        return;
      }

      if (!currentBuffer) {
        terminalContent.innerHTML = 'No buffer data available';
        return;
      }

      // Validate buffer data structure
      if (!currentBuffer.content || !currentBuffer.styles ||
          typeof currentBuffer.width !== 'number' || typeof currentBuffer.height !== 'number' ||
          currentBuffer.width <= 0 || currentBuffer.height <= 0) {
        console.error('Invalid buffer data structure:', currentBuffer);
        terminalContent.innerHTML = 'Invalid buffer data';
        return;
      }

      try {
        let html = '';

        for (let y = 0; y < currentBuffer.height; y++) {
          const contentRow = currentBuffer.content[y];
          const styleRow = currentBuffer.styles[y];

          if (!contentRow || !styleRow) {
            // Fill with spaces if row is missing
            for (let x = 0; x < currentBuffer.width; x++) {
              html += \`<span class="terminal-char" data-x="\${x}" data-y="\${y}">&nbsp;</span>\`;
            }
          } else {
            for (let x = 0; x < currentBuffer.width; x++) {
              const char = contentRow[x] || ' ';
              const style = styleRow[x];

              // Skip wide character continuation cells
              if (style && style.isWideCharContinuation) {
                continue;
              }

              let charStyle = '';
              const charWidth = (style && style.width) || 1;

              // Wide chars take 2ch width
              if (charWidth > 1) {
                charStyle += \`display: inline-block; width: \${charWidth}ch; \`;
              }

              if (style) {
                if (style.fg) charStyle += \`color: \${style.fg}; \`;
                if (style.bg) charStyle += \`background-color: \${style.bg}; \`;
                if (style.bold) charStyle += 'font-weight: bold; ';
                if (style.italic) charStyle += 'font-style: italic; ';
                if (style.underline) charStyle += 'text-decoration: underline; ';
              }

              const safeChar = char === ' ' ? '&nbsp;' :
                (char ? char.replace(/[<>&]/g, (m) => ({'<': '&lt;', '>': '&gt;', '&': '&amp;'}[m] || m)) : '&nbsp;');
              html += \`<span class="terminal-char" style="\${charStyle}" data-x="\${x}" data-y="\${y}">\${safeChar}</span>\`;
            }
          }

          if (y < currentBuffer.height - 1) html += '\\n';
        }

        terminalContent.innerHTML = html;
      } catch (error) {
        console.error('Error rendering terminal view:', error);
        terminalContent.innerHTML = \`Error rendering terminal: \${error.message}\`;
      }
    }

    let treeInitialized = false; // Track if tree has been initialized

    function renderDocumentTree() {
      const container = document.getElementById('documentTree');
      if (!container) return;

      if (!documentTree) {
        container.innerHTML = 'No tree data available';
        return;
      }

      try {
        // Handle both structured tree objects and string representations
        if (typeof documentTree.tree === 'string') {
          // If tree is a string (fallback), display it as preformatted text
          container.innerHTML = \`<pre style="margin: 0; color: #cccccc; white-space: pre-wrap;">\${documentTree.tree}</pre>\`;
        } else if (documentTree.tree && typeof documentTree.tree === 'object') {
          // Initialize collapsed nodes ONLY ONCE - preserve user's expand/collapse state
          if (!treeInitialized) {
            initializeTreeState(documentTree.tree);
            treeInitialized = true;
          }

          // If tree is a structured object, render as interactive tree
          container.innerHTML = renderTreeNode(documentTree.tree, 0, '');
        } else {
          container.innerHTML = 'Tree format not supported';
        }
      } catch (error) {
        console.error('Error rendering document tree:', error);
        container.innerHTML = \`Error rendering tree: \${error.message}\`;
      }
    }

    function initializeTreeState(tree) {
      // Only called once on first load
      // Start with root expanded and immediate children collapsed (for a clean initial view)
      if (tree && tree.children) {
        tree.children.forEach(child => {
          if (child.children && child.children.length > 0) {
            collapsedNodes.add(child.id);
          }
        });
      }
    }

    function renderTreeNode(node, depth, path) {
      if (!node) return '';

      const indent = '  '.repeat(depth);
      const hasChildren = node.children && node.children.length > 0;
      const isCollapsed = collapsedNodes.has(node.id);
      const icon = hasChildren ? (isCollapsed ? '▶' : '▼') : '○';
      const isFocused = node.id === focusedElement;
      const focusClass = isFocused ? ' focused' : '';

      let html = \`<div class="tree-node\${focusClass}" data-element-id="\${node.id}">
        \${indent}<span class="tree-icon" onclick="toggleNode('\${node.id}')">\${icon}</span>
        <span class="tree-label" onclick="selectElement('\${node.id}', '\${path}')">\${node.type}</span>
        <span class="tree-props" onclick="selectElement('\${node.id}', '\${path}')">\${getNodeProps(node)}</span>
      </div>\`;

      if (hasChildren) {
        const childrenClass = isCollapsed ? 'tree-children collapsed' : 'tree-children';
        html += \`<div class="\${childrenClass}" id="children-\${node.id}">\`;

        node.children.forEach((child, index) => {
          html += renderTreeNode(child, depth + 1, \`\${path}/\${index}\`);
        });

        html += '</div>';
      }

      return html;
    }

    function getNodeProps(node) {
      const props = [];
      if (node.props) {
        if (node.props.title) props.push(\`title="\${node.props.title}"\`);
        if (node.props.text && node.props.text.length < 20) props.push(\`text="\${node.props.text}"\`);
        if (node.props.value) props.push(\`value="\${node.props.value}"\`);
        if (node.props.checked) props.push('checked');
        if (node.props.disabled) props.push('disabled');
      }
      return props.join(' ');
    }

    function selectElement(elementId, path) {
      selectedElement = elementId;

      // Update tree selection
      document.querySelectorAll('.tree-node').forEach(node => {
        node.classList.remove('selected');
      });
      document.querySelector(\`[data-element-id="\${elementId}"]\`)?.classList.add('selected');

      // Show element details
      showElementDetails(elementId);

      // TODO: Highlight element in terminal view
    }

    function showElementDetails(elementId) {
      // This would show detailed information about the selected element
      const detailsPanel = document.getElementById('selectedElementDetails');
      detailsPanel.style.display = 'block';

      document.getElementById('elementType').textContent = \`ID: \${elementId}\`;
      // TODO: Fetch more detailed element information
    }

    function toggleNode(nodeId) {
      // Toggle collapsed state
      if (collapsedNodes.has(nodeId)) {
        collapsedNodes.delete(nodeId);
      } else {
        collapsedNodes.add(nodeId);
      }

      // Update the tree display
      const childrenContainer = document.getElementById(\`children-\${nodeId}\`);
      const iconElement = document.querySelector(\`[onclick="toggleNode('\${nodeId}')"\`);

      if (childrenContainer && iconElement) {
        if (collapsedNodes.has(nodeId)) {
          childrenContainer.classList.add('collapsed');
          iconElement.textContent = '▶';
        } else {
          childrenContainer.classList.remove('collapsed');
          iconElement.textContent = '▼';
        }
      }
    }

    function highlightFocusedElement() {
      // Update focused element in tree
      document.querySelectorAll('.tree-node').forEach(node => {
        node.classList.remove('focused');
      });
      if (focusedElement) {
        document.querySelector(\`[data-element-id="\${focusedElement}"]\`)?.classList.add('focused');
      }
    }

    function updateMouseCoords(event) {
      // Try to get coordinates from hovered character element
      let target = event.target;
      while (target && !target.dataset?.x && target !== event.currentTarget) {
        target = target.parentElement;
      }

      let x, y;
      if (target?.dataset?.x !== undefined && target?.dataset?.y !== undefined) {
        x = parseInt(target.dataset.x, 10);
        y = parseInt(target.dataset.y, 10);
      } else {
        // Fallback: calculate from pixel position
        const rect = event.currentTarget.getBoundingClientRect();
        const charWidth = 8.4;
        const lineHeight = 16.8;
        x = Math.floor((event.clientX - rect.left - 10) / charWidth);
        y = Math.floor((event.clientY - rect.top - 10) / lineHeight);
      }

      document.getElementById('mouseCoords').textContent = \`x: \${x}, y: \${y}\`;
    }

    function getClickCoords(event) {
      // Try to get coordinates from clicked character element
      let target = event.target;
      while (target && !target.dataset?.x && target !== event.currentTarget) {
        target = target.parentElement;
      }

      if (target?.dataset?.x !== undefined && target?.dataset?.y !== undefined) {
        return {
          x: parseInt(target.dataset.x, 10),
          y: parseInt(target.dataset.y, 10)
        };
      }

      // Fallback: calculate from pixel position
      const rect = event.currentTarget.getBoundingClientRect();
      const charWidth = 8.4;
      const lineHeight = 16.8;
      return {
        x: Math.floor((event.clientX - rect.left - 10) / charWidth),
        y: Math.floor((event.clientY - rect.top - 10) / lineHeight)
      };
    }

    function handleTerminalClick(event) {
      const { x, y } = getClickCoords(event);

      // Focus the terminal for keyboard input
      event.currentTarget.focus();

      // Inject click event only if event injection is enabled
      if (eventInjectionEnabled) {
        send({
          type: 'inject-click',
          data: { x, y, button: 'left' }
        });
      }
    }

    function handleTerminalRightClick(event) {
      event.preventDefault();
      const { x, y } = getClickCoords(event);

      // Focus the terminal for keyboard input
      event.currentTarget.focus();

      // Inject right click event only if event injection is enabled
      if (eventInjectionEnabled) {
        send({
          type: 'inject-click',
          data: { x, y, button: 'right' }
        });
      }
    }

    function handleKeyDown(event) {
      // Focus indicator
      terminalFocused();

      // Prevent default browser shortcuts for most keys
      if (!event.ctrlKey || ['c', 'v', 'x', 'a', 'z', 'y'].includes(event.key.toLowerCase())) {
        // Allow common editing shortcuts for the terminal
        // Everything else should be forwarded to terminal
        if (event.ctrlKey && ['c', 'v', 'x', 'a', 'z', 'y'].includes(event.key.toLowerCase())) {
          // Allow browser shortcuts for copy, paste, etc.
          return;
        }
        event.preventDefault();
      }

      // Build key event data
      const keyData = {
        key: event.key,
        code: event.code,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        metaKey: event.metaKey,
        keyCode: event.keyCode,
        which: event.which,
        type: 'keydown',
        timestamp: Date.now()
      };

      // Forwarding keydown event

      // Forward keyboard event to server only if event injection is enabled
      if (eventInjectionEnabled) {
        send({
          type: 'inject-key',
          data: keyData
        });
      }
    }

    function handleKeyUp(event) {
      // Build key event data for keyup
      const keyData = {
        key: event.key,
        code: event.code,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        metaKey: event.metaKey,
        keyCode: event.keyCode,
        which: event.which,
        type: 'keyup',
        timestamp: Date.now()
      };

      // Forward keyboard event to server only if event injection is enabled
      if (eventInjectionEnabled) {
        send({
          type: 'inject-key',
          data: keyData
        });
      }
    }

    function terminalFocused() {
      const terminal = document.getElementById('terminalView');
      if (terminal) {
        terminal.classList.add('interactive');
        // Terminal focused
      }
    }

    function terminalBlurred() {
      const terminal = document.getElementById('terminalView');
      if (terminal) {
        terminal.classList.remove('interactive');
        // Terminal blurred
      }
    }

    function searchElements(query) {
      // TODO: Implement element search functionality
      // Searching for element
    }

    // Log panel functions
    function addLogEntry(entry) {
      logEntries.push(entry);
      // Trim old entries if we exceed max
      while (logEntries.length > maxLogEntries) {
        logEntries.shift();
      }
      renderLogs();
    }

    function renderLogs() {
      const container = document.getElementById('logContent');
      if (!container) return;

      const filterLevel = document.getElementById('logLevelFilter')?.value || 'INFO';
      const minLevel = logLevels[filterLevel] || 0;

      const filteredEntries = logEntries.filter(entry => {
        const entryLevel = logLevels[entry.level] || 0;
        return entryLevel >= minLevel;
      });

      if (filteredEntries.length === 0) {
        container.innerHTML = '<div style="color: #808080; padding: 8px;">No log entries matching filter...</div>';
        return;
      }

      let html = '';
      filteredEntries.forEach(entry => {
        const timestamp = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : '';
        const source = entry.source ? \`<span class="log-source">[\${entry.source}]</span>\` : '';
        const context = entry.context && Object.keys(entry.context).length > 0
          ? \`<span class="log-context">\${JSON.stringify(entry.context)}</span>\`
          : '';

        html += \`<div class="log-entry">
          <span class="log-timestamp">\${timestamp}</span>
          <span class="log-level \${entry.level}">\${entry.level}</span>
          \${source}
          <span class="log-message">\${escapeHtml(entry.message)}</span>
          \${context}
        </div>\`;
      });

      container.innerHTML = html;
      // Auto-scroll to bottom
      container.scrollTop = container.scrollHeight;
    }

    function escapeHtml(text) {
      if (!text) return '';
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function filterLogs() {
      renderLogs();
    }

    function clearLogs() {
      logEntries = [];
      renderLogs();
    }

    // Auto-connect on load
    connect();
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

// Utility function to create and start debug server
export function createDebugServer(options?: DebugServerOptions): MelkerDebugServer {
  return new MelkerDebugServer(options);
}

// Check if debug server should be enabled
export function isDebugEnabled(): boolean {
  return MelkerConfig.get().debugPort !== undefined;
}

// Global debug server instance for logging integration
let globalDebugServer: MelkerDebugServer | undefined;

/**
 * Set the global debug server instance (called by engine when starting)
 */
export function setGlobalDebugServer(server: MelkerDebugServer | undefined): void {
  globalDebugServer = server;
}

/**
 * Get the global debug server instance (used by logging system)
 */
export function getGlobalDebugServer(): MelkerDebugServer | undefined {
  return globalDebugServer;
}