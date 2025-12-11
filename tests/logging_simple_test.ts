// Simple logging tests to verify basic functionality

import { assertEquals, assertExists, assertStringIncludes } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { createLogger, getLogger } from '../src/logging.ts';

const testLogDir = './test-logs-simple';
const cleanupTestLogs = async () => {
  try {
    await Deno.remove(testLogDir, { recursive: true });
  } catch (error) {
    // Directory might not exist
  }
};

const readLogFile = async (filepath: string): Promise<string> => {
  try {
    return await Deno.readTextFile(filepath);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read log file ${filepath}: ${errorMessage}`);
  }
};

Deno.test('Basic Logging Functionality', async () => {
  await cleanupTestLogs();

  // Ensure test log directory exists
  await Deno.mkdir(testLogDir, { recursive: true });

  const logger = createLogger({
    logFile: `${testLogDir}/basic.log`,
    level: 'DEBUG',
    format: 'text',
    bufferSize: 1, // Immediate writes
    asyncWrite: false, // Use sync writes for tests
  });

  // Test basic logging
  logger.info('Test info message');
  logger.warn('Test warning message');
  logger.error('Test error message', new Error('Test error'));

  // Wait and flush
  await new Promise(resolve => setTimeout(resolve, 100));
  logger.flush();

  // Verify log file was created and contains our messages
  const logContent = await readLogFile(`${testLogDir}/basic.log`);

  assertStringIncludes(logContent, 'Test info message');
  assertStringIncludes(logContent, 'Test warning message');
  assertStringIncludes(logContent, 'Test error message');
  assertStringIncludes(logContent, 'INFO');
  assertStringIncludes(logContent, 'WARN');
  assertStringIncludes(logContent, 'ERROR');

  logger.close();
  await cleanupTestLogs();
});

Deno.test('JSON Format Logging', async () => {
  await cleanupTestLogs();
  await Deno.mkdir(testLogDir, { recursive: true });

  const logger = createLogger({
    logFile: `${testLogDir}/json.log`,
    level: 'DEBUG',
    format: 'json',
    bufferSize: 1,
    asyncWrite: false,
  });

  logger.info('JSON test', { userId: 123, action: 'test' });

  await new Promise(resolve => setTimeout(resolve, 100));
  logger.flush();

  const logContent = await readLogFile(`${testLogDir}/json.log`);
  const lines = logContent.trim().split('\n').filter(line => line.trim());

  // Find our test message (skip session start messages)
  const testLine = lines.find(line => line.includes('JSON test'));
  assertExists(testLine);

  const entry = JSON.parse(testLine);
  assertEquals(entry.level, 'INFO');
  assertEquals(entry.message, 'JSON test');
  assertEquals(entry.context.userId, 123);
  assertEquals(entry.context.action, 'test');

  logger.close();
  await cleanupTestLogs();
});

Deno.test('Log Level Filtering', async () => {
  await cleanupTestLogs();
  await Deno.mkdir(testLogDir, { recursive: true });

  const logger = createLogger({
    logFile: `${testLogDir}/level.log`,
    level: 'WARN', // Only WARN, ERROR, FATAL
    format: 'text',
    bufferSize: 1,
    asyncWrite: false,
  });

  logger.debug('Should not appear');
  logger.info('Should not appear');
  logger.warn('Should appear');
  logger.error('Should appear');

  await new Promise(resolve => setTimeout(resolve, 100));
  logger.flush();

  const logContent = await readLogFile(`${testLogDir}/level.log`);

  assertStringIncludes(logContent, 'Should appear');
  assertEquals(logContent.includes('Should not appear'), false);

  logger.close();
  await cleanupTestLogs();
});

Deno.test('getLogger() should automatically set source', async () => {
  await cleanupTestLogs();

  const logger = getLogger('TestComponent');

  logger.info('Test message from component logger');
  logger.flush();

  const logContent = await readLogFile(`./logs/melker.log`);

  assertStringIncludes(logContent, 'TestComponent');
  assertStringIncludes(logContent, 'Test message from component logger');

  logger.close();
  await cleanupTestLogs();
});