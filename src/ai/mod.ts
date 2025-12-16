// AI module exports
// Provides AI-powered accessibility features for Melker

export {
  getOpenRouterConfig,
  streamChat,
  chat,
  type OpenRouterConfig,
  type ChatMessage,
  type StreamCallback,
  type ToolCallRequest,
  type ApiTool,
} from './openrouter.ts';

export {
  buildContext,
  buildSystemPrompt,
  hashContext,
  type UIContext,
} from './context.ts';

export {
  QueryCache,
  getGlobalCache,
  setGlobalCache,
  type CacheEntry,
} from './cache.ts';

export {
  AccessibilityDialogManager,
  type AccessibilityDialogDependencies,
} from './accessibility-dialog.ts';

export {
  TOOL_DEFINITIONS,
  toolsToOpenRouterFormat,
  executeTool,
  registerAITool,
  unregisterAITool,
  getCustomTools,
  clearCustomTools,
  type ToolDefinition,
  type ToolParameter,
  type ToolCall,
  type ToolResult,
  type ToolContext,
  type CustomToolDefinition,
} from './tools.ts';

export {
  AudioRecorder,
  transcribeAudio,
  hasAudioContent,
  trimSilence,
  getWavDuration,
} from './audio.ts';
