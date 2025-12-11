// File-based logging system for melker applications
// Provides structured logging with multiple output formats

import { getGlobalDebugServer } from './debug-server.ts';

// Flag to track if logging is disabled (e.g., no log file specified)
let loggingDisabled = false;

/**
 * Get default log file path (~/.cache/melker/logs/melker.log)
 */
function getDefaultLogFile(): string {
  try {
    const home = Deno.env.get('HOME') || Deno.env.get('USERPROFILE') || '.';
    return `${home}/.cache/melker/logs/melker.log`;
  } catch {
    return './logs/melker.log'; // Fallback if env access fails
  }
}

/**
 * Check if we have write permission for a path.
 * Uses Deno.permissions.querySync to check without triggering a prompt.
 */
function hasWritePermission(path: string): boolean {
  try {
    const status = Deno.permissions.querySync({ name: 'write', path });
    return status.state === 'granted';
  } catch {
    // If querySync fails, assume no permission
    return false;
  }
}

/**
 * Exit with an error message about missing write permission.
 */
function exitWithPermissionError(logFile: string): never {
  const logDir = logFile.includes('/')
    ? logFile.substring(0, logFile.lastIndexOf('/'))
    : '.';

  console.error('\n\x1b[31mError: Cannot write to log file - write permission not granted.\x1b[0m');
  console.error(`  Log file: ${logFile}`);
  console.error(`  Log directory: ${logDir}`);
  console.error('\n\x1b[33mOptions:\x1b[0m');
  console.error('');
  console.error('  \x1b[1m1. Disable logging\x1b[0m (set MELKER_LOG_FILE to empty string):');
  console.error('     MELKER_LOG_FILE= deno run --allow-read --allow-env src/melker.ts <file>');
  console.error('');
  console.error('  \x1b[1m2. Write logs to a different location\x1b[0m (set MELKER_LOG_FILE):');
  console.error('     MELKER_LOG_FILE=/tmp/melker.log deno run --allow-read --allow-env --allow-write=/tmp src/melker.ts <file>');
  console.error('');
  console.error('  \x1b[1m3. Grant write permission\x1b[0m to the default log directory:');
  console.error(`     deno run --allow-read --allow-env --allow-write=${logDir} src/melker.ts <file>`);
  console.error('');
  console.error('  \x1b[1m4. Grant all permissions\x1b[0m:');
  console.error('     deno run --allow-all src/melker.ts <file>');
  console.error('');
  Deno.exit(1);
}

export type LogLevel = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  error?: Error;
  source?: string;
  sessionId?: string;
}

export interface LoggerOptions {
  // File configuration
  logFile?: string; // Path to log file (absolute or relative)

  // Log level filtering
  level?: LogLevel;

  // Format options
  format?: 'json' | 'text' | 'structured';
  includeTimestamp?: boolean;
  includeLevel?: boolean;
  includeSource?: boolean;

  // Performance options
  bufferSize?: number;
  flushInterval?: number; // in milliseconds
  asyncWrite?: boolean;

  // Console output
  consoleOutput?: boolean;
  consoleLevel?: LogLevel;
}

export interface LoggerStats {
  totalEntries: number;
  entriesByLevel: Record<LogLevel, number>;
  currentFileSize: number;
  bufferSize: number;
  lastFlush: Date;
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
  private _options: Required<LoggerOptions>;
  private _buffer: LogEntry[] = [];
  private _stats: LoggerStats;
  private _flushTimer?: number;
  private _currentLogFile?: string;
  private _fileHandle?: Deno.FsFile;
  private _sessionId: string;

  constructor(options: LoggerOptions = {}) {
    this._options = {
      logFile: options.logFile || getDefaultLogFile(),
      level: options.level || 'INFO',
      format: options.format || 'structured',
      includeTimestamp: options.includeTimestamp ?? true,
      includeLevel: options.includeLevel ?? true,
      includeSource: options.includeSource ?? true,
      bufferSize: options.bufferSize || 100,
      flushInterval: options.flushInterval || 1000, // 1 second
      asyncWrite: options.asyncWrite ?? true,
      consoleOutput: options.consoleOutput ?? false,
      consoleLevel: options.consoleLevel || 'WARN',
    };

    this._sessionId = this._generateSessionId();
    this._stats = {
      totalEntries: 0,
      entriesByLevel: { TRACE: 0, DEBUG: 0, INFO: 0, WARN: 0, ERROR: 0, FATAL: 0 },
      currentFileSize: 0,
      bufferSize: 0,
      lastFlush: new Date(),
    };

    // Don't call _initialize() here - it's async and constructor should be sync
    // Initialize will be called from an async wrapper
  }

  private _generateSessionId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  async initialize(): Promise<void> {
    if (this._currentLogFile) {
      return; // Already initialized
    }

    // Check if logging is disabled (empty log file path)
    if (!this._options.logFile || this._options.logFile.trim() === '') {
      loggingDisabled = true;
      return;
    }

    // Use the log file path directly
    this._currentLogFile = this._options.logFile;

    // Extract directory from log file path
    const logDir = this._currentLogFile.includes('/')
      ? this._currentLogFile.substring(0, this._currentLogFile.lastIndexOf('/'))
      : '.';

    // Check write permission BEFORE attempting any writes (to avoid Deno permission prompt)
    if (!hasWritePermission(logDir || '.')) {
      exitWithPermissionError(this._currentLogFile);
    }

    // Ensure log directory exists
    if (logDir && logDir !== '.') {
      try {
        await Deno.mkdir(logDir, { recursive: true });
      } catch (error) {
        if (error instanceof Deno.errors.PermissionDenied) {
          exitWithPermissionError(this._currentLogFile);
        }
        if (!(error instanceof Deno.errors.AlreadyExists)) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`Failed to create log directory "${logDir}": ${errorMessage}`);
          Deno.exit(1);
        }
      }
    }

    // Set up periodic flushing
    if (this._options.flushInterval > 0) {
      this._flushTimer = setInterval(() => {
        this._flushSync();
      }, this._options.flushInterval);
    }

    // Log session start
    this._writeEntry({
      timestamp: new Date(),
      level: 'INFO',
      message: 'Logging session started',
      context: {
        sessionId: this._sessionId,
        logFile: this._currentLogFile,
      },
      source: 'Logger',
    });
  }

  initializeSync(): void {
    if (this._currentLogFile) {
      return; // Already initialized
    }

    // Check if logging is disabled (empty log file path)
    if (!this._options.logFile || this._options.logFile.trim() === '') {
      loggingDisabled = true;
      return;
    }

    // Use the log file path directly
    this._currentLogFile = this._options.logFile;

    // Extract directory from log file path
    const logDir = this._currentLogFile.includes('/')
      ? this._currentLogFile.substring(0, this._currentLogFile.lastIndexOf('/'))
      : '.';

    // Check write permission BEFORE attempting any writes (to avoid Deno permission prompt)
    if (!hasWritePermission(logDir || '.')) {
      exitWithPermissionError(this._currentLogFile);
    }

    // Ensure log directory exists
    if (logDir && logDir !== '.') {
      try {
        Deno.mkdirSync(logDir, { recursive: true });
      } catch (error) {
        if (error instanceof Deno.errors.PermissionDenied) {
          exitWithPermissionError(this._currentLogFile);
        }
        if (!(error instanceof Deno.errors.AlreadyExists)) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`Failed to create log directory "${logDir}": ${errorMessage}`);
          Deno.exit(1);
        }
      }
    }

    // Set up periodic flushing
    if (this._options.flushInterval > 0) {
      this._flushTimer = setInterval(() => {
        this._flushSync();
      }, this._options.flushInterval);
    }

    // Log session start
    this._writeEntry({
      timestamp: new Date(),
      level: 'INFO',
      message: 'Logging session started',
      context: {
        sessionId: this._sessionId,
        logFile: this._currentLogFile,
      },
      source: 'Logger',
    });
  }

  private _initializeSync(): void {
    this.initializeSync();
  }

  private _shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this._options.level];
  }

  private _shouldConsole(level: LogLevel): boolean {
    return this._options.consoleOutput &&
           LOG_LEVELS[level] >= LOG_LEVELS[this._options.consoleLevel];
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

      case 'text':
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

      case 'structured':
      default:
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

  private _writeEntry(entry: LogEntry): void {
    // Ensure initialization
    if (!this._currentLogFile && !loggingDisabled) {
      this._initializeSync();
    }

    // Skip file operations if logging is disabled
    if (loggingDisabled) {
      // Still broadcast to debug server if available
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
      return;
    }

    // Update stats
    this._stats.totalEntries++;
    this._stats.entriesByLevel[entry.level]++;

    // Console output if enabled
    if (this._shouldConsole(entry.level)) {
      const formatted = this._formatEntry(entry);
      if (entry.level === 'ERROR' || entry.level === 'FATAL') {
        console.error(formatted.trim());
      } else if (entry.level === 'WARN') {
        console.warn(formatted.trim());
      } else {
        console.log(formatted.trim());
      }
    }

    // Broadcast to debug server if available (for UI mirror)
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

    // Add to buffer
    this._buffer.push(entry);
    this._stats.bufferSize = this._buffer.length;

    // Flush if buffer is full
    if (this._buffer.length >= this._options.bufferSize) {
      this._flushSync();
    }
  }

  private async _flush(): Promise<void> {
    if (this._buffer.length === 0 || loggingDisabled) return;

    // Format all buffered entries
    const entries = this._buffer.splice(0);
    const content = entries.map(entry => this._formatEntry(entry)).join('');

    try {
      // Write to file
      if (this._options.asyncWrite) {
        await this._writeToFileAsync(content);
      } else {
        await this._writeToFileSync(content);
      }

      this._stats.currentFileSize += new TextEncoder().encode(content).length;
      this._stats.lastFlush = new Date();
      this._stats.bufferSize = this._buffer.length;

    } catch (error) {
      if (error instanceof Deno.errors.PermissionDenied) {
        exitWithPermissionError(this._currentLogFile!);
      }
      // Re-add entries to buffer on write failure
      this._buffer.unshift(...entries);
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to write to log file: ${errorMessage}`);
    }
  }

  private _flushSync(): void {
    if (this._buffer.length === 0 || loggingDisabled) return;

    // Format all buffered entries
    const entries = this._buffer.splice(0);
    const content = entries.map(entry => this._formatEntry(entry)).join('');

    try {
      // Write to file synchronously
      this._writeToFileSyncOnly(content);

      this._stats.currentFileSize += new TextEncoder().encode(content).length;
      this._stats.lastFlush = new Date();
      this._stats.bufferSize = this._buffer.length;

    } catch (error) {
      if (error instanceof Deno.errors.PermissionDenied) {
        exitWithPermissionError(this._currentLogFile!);
      }
      // Re-add entries to buffer on write failure
      this._buffer.unshift(...entries);
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to write to log file: ${errorMessage}`);
    }
  }

  private async _writeToFileAsync(content: string): Promise<void> {
    if (loggingDisabled || !this._currentLogFile) {
      return;
    }

    try {
      if (!this._fileHandle) {
        this._fileHandle = await Deno.open(this._currentLogFile!, {
          create: true,
          write: true,
          append: true,
        });
      }

      const encoder = new TextEncoder();
      await this._fileHandle.write(encoder.encode(content));
    } catch (error) {
      if (error instanceof Deno.errors.PermissionDenied) {
        exitWithPermissionError(this._currentLogFile!);
      }
      throw error;
    }
  }

  private async _writeToFileSync(content: string): Promise<void> {
    if (loggingDisabled || !this._currentLogFile) {
      return;
    }

    try {
      await Deno.writeTextFile(this._currentLogFile!, content, { append: true });
    } catch (error) {
      if (error instanceof Deno.errors.PermissionDenied) {
        exitWithPermissionError(this._currentLogFile!);
      }
      throw error;
    }
  }

  private _writeToFileSyncOnly(content: string): void {
    if (loggingDisabled || !this._currentLogFile) {
      return; // Logging disabled, silently skip
    }

    try {
      Deno.writeTextFileSync(this._currentLogFile!, content, { append: true });
    } catch (error) {
      if (error instanceof Deno.errors.PermissionDenied) {
        exitWithPermissionError(this._currentLogFile!);
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Failed to write to log file "${this._currentLogFile}": ${errorMessage}`);
      Deno.exit(1);
    }
  }


  // Public logging methods

  trace(message: string, context?: Record<string, unknown>, source?: string): void {
    if (!this._shouldLog('TRACE')) return;
    this._writeEntry({
      timestamp: new Date(),
      level: 'TRACE',
      message,
      context,
      source,
      sessionId: this._sessionId,
    });
  }

  debug(message: string, context?: Record<string, unknown>, source?: string): void {
    if (!this._shouldLog('DEBUG')) return;
    this._writeEntry({
      timestamp: new Date(),
      level: 'DEBUG',
      message,
      context,
      source,
      sessionId: this._sessionId,
    });
  }

  info(message: string, context?: Record<string, unknown>, source?: string): void {
    if (!this._shouldLog('INFO')) return;
    this._writeEntry({
      timestamp: new Date(),
      level: 'INFO',
      message,
      context,
      source,
      sessionId: this._sessionId,
    });
  }

  warn(message: string, context?: Record<string, unknown>, source?: string): void {
    if (!this._shouldLog('WARN')) return;
    this._writeEntry({
      timestamp: new Date(),
      level: 'WARN',
      message,
      context,
      source,
      sessionId: this._sessionId,
    });
  }

  error(message: string, error?: Error, context?: Record<string, unknown>, source?: string): void {
    if (!this._shouldLog('ERROR')) return;
    this._writeEntry({
      timestamp: new Date(),
      level: 'ERROR',
      message,
      error,
      context,
      source,
      sessionId: this._sessionId,
    });
  }

  fatal(message: string, error?: Error, context?: Record<string, unknown>, source?: string): void {
    if (!this._shouldLog('FATAL')) return;
    this._writeEntry({
      timestamp: new Date(),
      level: 'FATAL',
      message,
      error,
      context,
      source,
      sessionId: this._sessionId,
    });
  }

  // Utility methods

  flush(): void {
    this._flushSync();
  }

  setLevel(level: LogLevel): void {
    this._options.level = level;
  }

  getStats(): LoggerStats {
    return { ...this._stats };
  }

  close(): void {
    // Clear flush timer first
    if (this._flushTimer) {
      clearInterval(this._flushTimer);
      this._flushTimer = undefined;
    }

    // Skip file operations if logging is disabled
    if (loggingDisabled) {
      return;
    }

    // Add session end to buffer (synchronous operation)
    this._buffer.push({
      timestamp: new Date(),
      level: 'INFO',
      message: 'Logging session ended',
      context: {
        sessionId: this._sessionId,
        stats: this._stats,
      },
      source: 'Logger',
      sessionId: this._sessionId,
    });

    // Best-effort final flush using synchronous write
    if (this._buffer.length > 0 && this._currentLogFile) {
      const entries = this._buffer.splice(0);
      const content = entries.map(entry => this._formatEntry(entry)).join('');

      // Use synchronous write for final flush
      try {
        Deno.writeTextFileSync(this._currentLogFile, content, { append: true });
      } catch (_error) {
        // Silently ignore permission errors on close
      }
    }

    // Close file handle
    if (this._fileHandle) {
      try {
        this._fileHandle.close();
      } catch (_error) {
        // Handle already closed file
      }
      this._fileHandle = undefined;
    }
  }
}

// Environment variable configuration helpers
function getLogLevelFromEnv(): LogLevel | undefined {
  const envLevel = Deno.env.get('MELKER_LOG_LEVEL');
  if (envLevel && envLevel.toUpperCase() in LOG_LEVELS) {
    return envLevel.toUpperCase() as LogLevel;
  }
  return undefined;
}

function getLogFileFromEnv(): string | undefined {
  return Deno.env.get('MELKER_LOG_FILE');
}

function createDefaultLoggerOptions(): LoggerOptions {
  const envLogLevel = getLogLevelFromEnv();
  const envLogFile = getLogFileFromEnv();

  return {
    // Environment variables take precedence over defaults
    level: envLogLevel || 'INFO', // Info logging enabled by default as requested
    logFile: envLogFile || getDefaultLogFile(),
    // Set sensible defaults for file logging
    format: 'structured',
    includeTimestamp: true,
    includeLevel: true,
    includeSource: true,
    bufferSize: 100,
    flushInterval: 1000, // 1 second
    asyncWrite: true,
    consoleOutput: false, // Disable console output for terminal UIs
    consoleLevel: 'ERROR',
  };
}

// Global logger instance
let globalLogger: Logger | undefined;

export function createLogger(options?: LoggerOptions): Logger {
  // Merge provided options with defaults from environment
  const defaultOptions = createDefaultLoggerOptions();
  const mergedOptions = { ...defaultOptions, ...options };

  const logger = new Logger(mergedOptions);
  logger.initializeSync();
  return logger;
}

export function getGlobalLogger(): Logger {
  if (!globalLogger) {
    globalLogger = new Logger(createDefaultLoggerOptions());
    globalLogger.initializeSync();
  }
  return globalLogger;
}

export function setGlobalLogger(logger: Logger): void {
  globalLogger = logger;
}

export function getGlobalLoggerOptions(): { logFile: string; level: LogLevel } {
  const options = createDefaultLoggerOptions();
  return {
    logFile: options.logFile || 'disabled',
    level: options.level || 'INFO',
  };
}

// Component-specific logger interface that automatically includes source
export interface ComponentLogger {
  trace: (message: string, context?: Record<string, unknown>) => void;
  debug: (message: string, context?: Record<string, unknown>) => void;
  info: (message: string, context?: Record<string, unknown>) => void;
  warn: (message: string, context?: Record<string, unknown>) => void;
  error: (message: string, error?: Error, context?: Record<string, unknown>) => void;
  fatal: (message: string, error?: Error, context?: Record<string, unknown>) => void;
  flush: () => void;
  close: () => void;
}

export function getLogger(name: string): ComponentLogger {
  const baseLogger = getGlobalLogger();

  return {
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

    flush: () => baseLogger.flush(),
    close: () => baseLogger.close(),
  };
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