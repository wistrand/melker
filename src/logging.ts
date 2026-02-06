// File-based logging system for melker applications
// Simple synchronous logging - lost lines are lost

import { getGlobalDebugServer } from './debug-server.ts';
import { Env } from './env.ts';
import { MelkerConfig } from './config/mod.ts';

// Flag to track if logging is disabled (e.g., no log file specified)
let loggingDisabled = false;

// In-memory log buffer for DevTools Log tab
const logBuffer: LogEntry[] = [];

/**
 * Get configured log buffer max size
 */
function getLogBufferMaxSize(): number {
  return MelkerConfig.get().getNumber('log.bufferSize', 500);
}

/**
 * Add an entry to the in-memory log buffer (FIFO)
 */
function addToLogBuffer(entry: LogEntry): void {
  logBuffer.push(entry);
  const maxSize = getLogBufferMaxSize();
  while (logBuffer.length > maxSize) {
    logBuffer.shift();
  }
}

/**
 * Get recent log entries from the in-memory buffer
 */
export function getRecentLogEntries(count?: number): LogEntry[] {
  if (count === undefined || count >= logBuffer.length) {
    return [...logBuffer];
  }
  return logBuffer.slice(-count);
}

/**
 * Clear the in-memory log buffer
 */
export function clearLogBuffer(): void {
  logBuffer.length = 0;
}

/**
 * Get the current log buffer size
 */
export function getLogBufferSize(): number {
  return logBuffer.length;
}

/**
 * Get default log file path (~/.cache/melker/logs/melker.log)
 */
function getDefaultLogFile(): string {
  try {
    const home = Env.get('HOME') || Env.get('USERPROFILE') || '.';
    return `${home}/.cache/melker/logs/melker.log`;
  } catch {
    return './logs/melker.log';
  }
}

/**
 * Check if we have write permission for a path.
 */
function hasWritePermission(path: string): boolean {
  try {
    const status = Deno.permissions.querySync({ name: 'write', path });
    return status.state === 'granted';
  } catch {
    return false;
  }
}

export type LogLevel = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  error?: Error;
  source?: string;
}

export interface LoggerOptions {
  logFile?: string;
  level?: LogLevel;
  format?: 'json' | 'text' | 'structured';
  includeTimestamp?: boolean;
  includeLevel?: boolean;
  includeSource?: boolean;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  TRACE: 0,
  DEBUG: 1,
  INFO: 2,
  WARN: 3,
  ERROR: 4,
  FATAL: 5,
};

export class Logger {
  private _options: Required<Omit<LoggerOptions, 'logFile'>> & { logFile: string };
  private _logFile: string | null = null;
  private _initialized = false;

  constructor(options: LoggerOptions = {}) {
    this._options = {
      logFile: options.logFile ?? getDefaultLogFile(),
      level: options.level ?? 'INFO',
      format: options.format ?? 'structured',
      includeTimestamp: options.includeTimestamp ?? true,
      includeLevel: options.includeLevel ?? true,
      includeSource: options.includeSource ?? true,
    };
  }

  private _ensureInitialized(): void {
    if (this._initialized) return;
    this._initialized = true;

    // Check if logging is disabled
    if (!this._options.logFile || this._options.logFile.trim() === '') {
      loggingDisabled = true;
      return;
    }

    this._logFile = this._options.logFile;

    // Extract directory
    const logDir = this._logFile.includes('/')
      ? this._logFile.substring(0, this._logFile.lastIndexOf('/'))
      : '.';

    // Check write permission
    if (!hasWritePermission(logDir || '.')) {
      // Disable logging instead of exiting
      loggingDisabled = true;
      return;
    }

    // Ensure log directory exists
    if (logDir && logDir !== '.') {
      try {
        Deno.mkdirSync(logDir, { recursive: true });
      } catch {
        // Directory might already exist or we can't create it - disable logging
        loggingDisabled = true;
        return;
      }
    }
  }

  private _shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this._options.level];
  }

  private _formatEntry(entry: LogEntry): string {
    switch (this._options.format) {
      case 'json':
        return JSON.stringify({
          ...entry,
          timestamp: entry.timestamp.toISOString(),
          error: entry.error ? {
            message: entry.error.message,
            stack: entry.error.stack,
            name: entry.error.name,
          } : undefined,
        }) + '\n';

      case 'text': {
        let text = '';
        if (this._options.includeTimestamp) {
          text += `[${entry.timestamp.toISOString()}] `;
        }
        if (this._options.includeLevel) {
          text += `${entry.level.padEnd(5)} `;
        }
        if (this._options.includeSource && entry.source) {
          text += `[${entry.source}] `;
        }
        text += entry.message;
        if (entry.context && Object.keys(entry.context).length > 0) {
          text += ` | ${JSON.stringify(entry.context)}`;
        }
        if (entry.error) {
          text += ` | ERROR: ${entry.error.message}`;
        }
        return text + '\n';
      }

      case 'structured':
      default: {
        let structured = '';
        if (this._options.includeTimestamp) {
          structured += `${entry.timestamp.toISOString()} `;
        }
        if (this._options.includeLevel) {
          structured += `[${entry.level}] `;
        }
        if (this._options.includeSource && entry.source) {
          structured += `${entry.source}: `;
        }
        structured += entry.message;

        if (entry.context && Object.keys(entry.context).length > 0) {
          structured += ' | ' + Object.entries(entry.context)
            .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
            .join(', ');
        }
        if (entry.error) {
          structured += `\n  Error: ${entry.error.message}`;
          if (entry.error.stack) {
            structured += `\n  Stack: ${entry.error.stack}`;
          }
        }
        return structured + '\n';
      }
    }
  }

  private _writeEntry(entry: LogEntry): void {
    this._ensureInitialized();

    // Add to in-memory buffer (always, regardless of file logging)
    addToLogBuffer(entry);

    // Broadcast to debug server if available
    const debugServer = getGlobalDebugServer();
    if (debugServer?.isRunning) {
      debugServer.broadcastLog({
        level: entry.level,
        message: entry.message,
        source: entry.source,
        context: entry.context,
        timestamp: entry.timestamp,
      });
    }

    // Skip file write if logging is disabled
    if (loggingDisabled || !this._logFile) {
      return;
    }

    // Write synchronously - lost lines are lost
    try {
      const content = this._formatEntry(entry);
      Deno.writeTextFileSync(this._logFile, content, { append: true });
    } catch {
      // Silently ignore write errors - lost lines are lost
    }
  }

  // Public logging methods

  trace(message: string, context?: Record<string, unknown>, source?: string): void {
    if (!this._shouldLog('TRACE')) return;
    this._writeEntry({ timestamp: new Date(), level: 'TRACE', message, context, source });
  }

  debug(message: string, context?: Record<string, unknown>, source?: string): void {
    if (!this._shouldLog('DEBUG')) return;
    this._writeEntry({ timestamp: new Date(), level: 'DEBUG', message, context, source });
  }

  info(message: string, context?: Record<string, unknown>, source?: string): void {
    if (!this._shouldLog('INFO')) return;
    this._writeEntry({ timestamp: new Date(), level: 'INFO', message, context, source });
  }

  warn(message: string, context?: Record<string, unknown>, source?: string): void {
    if (!this._shouldLog('WARN')) return;
    this._writeEntry({ timestamp: new Date(), level: 'WARN', message, context, source });
  }

  error(message: string, error?: Error, context?: Record<string, unknown>, source?: string): void {
    if (!this._shouldLog('ERROR')) return;
    this._writeEntry({ timestamp: new Date(), level: 'ERROR', message, error, context, source });
  }

  fatal(message: string, error?: Error, context?: Record<string, unknown>, source?: string): void {
    if (!this._shouldLog('FATAL')) return;
    this._writeEntry({ timestamp: new Date(), level: 'FATAL', message, error, context, source });
  }

  // Level check methods for guarding expensive log message construction
  isTraceEnabled(): boolean {
    return this._shouldLog('TRACE');
  }

  isDebugEnabled(): boolean {
    return this._shouldLog('DEBUG');
  }

  // Utility methods (kept for API compatibility)

  flush(): void {
    // No-op - writes are synchronous
  }

  setLevel(level: LogLevel): void {
    this._options.level = level;
  }

  /**
   * Reconfigure the logger with fresh options from config.
   * Resets initialization state so log file and level changes take effect.
   */
  reconfigure(options: LoggerOptions): void {
    this._options = {
      logFile: options.logFile ?? getDefaultLogFile(),
      level: options.level ?? 'INFO',
      format: options.format ?? 'structured',
      includeTimestamp: options.includeTimestamp ?? true,
      includeLevel: options.includeLevel ?? true,
      includeSource: options.includeSource ?? true,
    };
    this._initialized = false;
    this._logFile = null;
    loggingDisabled = false;
  }

  close(): void {
    // No-op - no resources to clean up
  }
}

// Configuration from MelkerConfig
function getLogLevelFromConfig(): LogLevel {
  const config = MelkerConfig.get();
  return (config.logLevel?.toUpperCase() || 'INFO') as LogLevel;
}

function getLogFileFromConfig(): string | undefined {
  const config = MelkerConfig.get();
  return config.logFile;
}

function createDefaultLoggerOptions(): LoggerOptions {
  return {
    level: getLogLevelFromConfig(),
    logFile: getLogFileFromConfig() ?? getDefaultLogFile(),
    format: 'structured',
    includeTimestamp: true,
    includeLevel: true,
    includeSource: true,
  };
}

// Global logger instance
let globalLogger: Logger | undefined;

export function createLogger(options?: LoggerOptions): Logger {
  const defaultOptions = createDefaultLoggerOptions();
  return new Logger({ ...defaultOptions, ...options });
}

export function getGlobalLogger(): Logger {
  if (!globalLogger) {
    globalLogger = new Logger(createDefaultLoggerOptions());
  }
  return globalLogger;
}

export function setGlobalLogger(logger: Logger): void {
  globalLogger = logger;
}

/**
 * Reconfigure the global logger with current config values.
 * Call after CLI flags are applied to pick up --log-level and --log-file.
 */
export function reconfigureGlobalLogger(): void {
  if (globalLogger) {
    globalLogger.reconfigure(createDefaultLoggerOptions());
  }
}

export function getGlobalLoggerOptions(): { logFile: string; level: LogLevel } {
  const options = createDefaultLoggerOptions();
  return {
    logFile: options.logFile || 'disabled',
    level: options.level || 'INFO',
  };
}

// Component-specific logger interface
export interface ComponentLogger {
  trace: (message: string, context?: Record<string, unknown>) => void;
  debug: (message: string, context?: Record<string, unknown>) => void;
  info: (message: string, context?: Record<string, unknown>) => void;
  warn: (message: string, context?: Record<string, unknown>) => void;
  error: (message: string, error?: Error, context?: Record<string, unknown>) => void;
  fatal: (message: string, error?: Error, context?: Record<string, unknown>) => void;
  isTraceEnabled: () => boolean;
  isDebugEnabled: () => boolean;
  flush: () => void;
  close: () => void;
}

// Cache for component loggers - avoids creating new wrapper objects on each getLogger() call
const loggerCache = new Map<string, ComponentLogger>();

export function getLogger(name: string): ComponentLogger {
  const cached = loggerCache.get(name);
  if (cached) return cached;

  const baseLogger = getGlobalLogger();

  const logger: ComponentLogger = {
    trace: (message: string, context?: Record<string, unknown>) =>
      baseLogger.trace(message, context, name),
    debug: (message: string, context?: Record<string, unknown>) =>
      baseLogger.debug(message, context, name),
    info: (message: string, context?: Record<string, unknown>) =>
      baseLogger.info(message, context, name),
    warn: (message: string, context?: Record<string, unknown>) =>
      baseLogger.warn(message, context, name),
    error: (message: string, error?: Error, context?: Record<string, unknown>) =>
      baseLogger.error(message, error, context, name),
    fatal: (message: string, error?: Error, context?: Record<string, unknown>) =>
      baseLogger.fatal(message, error, context, name),
    isTraceEnabled: () => baseLogger.isTraceEnabled(),
    isDebugEnabled: () => baseLogger.isDebugEnabled(),
    flush: () => baseLogger.flush(),
    close: () => baseLogger.close(),
  };

  loggerCache.set(name, logger);
  return logger;
}

// Convenience functions using global logger
export const log = {
  trace: (message: string, context?: Record<string, unknown>, source?: string) =>
    getGlobalLogger().trace(message, context, source),
  debug: (message: string, context?: Record<string, unknown>, source?: string) =>
    getGlobalLogger().debug(message, context, source),
  info: (message: string, context?: Record<string, unknown>, source?: string) =>
    getGlobalLogger().info(message, context, source),
  warn: (message: string, context?: Record<string, unknown>, source?: string) =>
    getGlobalLogger().warn(message, context, source),
  error: (message: string, error?: Error, context?: Record<string, unknown>, source?: string) =>
    getGlobalLogger().error(message, error, context, source),
  fatal: (message: string, error?: Error, context?: Record<string, unknown>, source?: string) =>
    getGlobalLogger().fatal(message, error, context, source),
};
