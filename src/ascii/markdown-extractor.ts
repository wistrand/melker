// Markdown extractor for melker-block code blocks

import { BoxStructure, ParseError, ParseResult } from './types.ts';
import { parseAsciiBoxes, parseButtonShortcuts } from './parser.ts';
import { renderToMelker, RenderContext } from './melker-renderer.ts';
import { ERROR_MESSAGES, formatParseError } from './errors.ts';

export interface ExtractedBlock {
  type: 'root' | 'component' | 'script' | 'handler' | 'style' | 'json' | 'json-props' | 'title' | 'oauth' | 'policy' | 'external-scripts';
  name?: string;
  elementId?: string;
  event?: string;
  content: string;
  line: number;
  /** Prose text preceding this block (for XML comments) */
  precedingProse?: string;
  /** Script type: 'sync' (default), 'init' (before render), 'ready' (after render) */
  scriptType?: 'sync' | 'init' | 'ready';
}

export interface ExternalScript {
  name: string;
  src: string;
}

export interface OAuthConfig {
  provider?: string;
  wellknown?: string;
  clientId?: string;
  audience?: string;
  scopes?: string[];
  autoLogin?: boolean;
  onLogin?: string;
  onLogout?: string;
  onFail?: string;
  [key: string]: unknown;
}

export interface MarkdownParseResult {
  /** Generated melker XML */
  melker?: string;
  /** Parse errors */
  errors: ParseError[];
  /** Warnings */
  warnings: ParseError[];
  /** Source file path (for error messages) */
  filePath?: string;
}

interface CodeBlock {
  lang: string;
  /** Additional modifier after lang (e.g., "oauth" in "json oauth") */
  langModifier?: string;
  content: string;
  startLine: number;
  /** Prose text preceding this code block */
  precedingProse?: string;
}

export interface ParseOptions {
  /** Registered element types from engine */
  elementTypes?: Set<string>;
}

/**
 * Extract and parse melker blocks from markdown content
 */
export function parseMarkdownMelker(
  markdown: string,
  filePath?: string,
  options?: ParseOptions
): MarkdownParseResult {
  const errors: ParseError[] = [];
  const warnings: ParseError[] = [];

  // Extract all code blocks
  const codeBlocks = extractCodeBlocks(markdown);

  // Categorize blocks
  const blocks = categorizeBlocks(codeBlocks, errors);

  // Validate: at least one melker-block required (first becomes root)
  const rootBlocks = blocks.filter((b) => b.type === 'root');
  if (rootBlocks.length === 0) {
    errors.push({
      message: ERROR_MESSAGES.missingRoot(),
    });
    return { errors, warnings, filePath };
  }

  // Parse component blocks FIRST to know what IDs are available
  const components = new Map<string, BoxStructure>();
  const componentComments = new Map<string, string>();
  const componentBlocks = blocks.filter((b) => b.type === 'component');
  const allButtons: ButtonWithId[] = [];

  for (const block of componentBlocks) {
    const parseResult = parseAsciiBoxWithButtons(block.content, block.line);

    if (parseResult.errors.length > 0) {
      errors.push(...parseResult.errors.map((e) => ({
        ...e,
        line: e.line ? e.line + block.line : block.line,
      })));
      continue;
    }

    // Collect buttons from component blocks
    if (parseResult.buttons) {
      allButtons.push(...parseResult.buttons);
    }

    if (parseResult.structure && parseResult.structure.rootBoxes.length > 0) {
      const componentId = parseResult.structure.rootBoxes[0].id;
      components.set(componentId, parseResult.structure);
      // Track preceding prose as comment for this component
      if (block.precedingProse) {
        componentComments.set(componentId, block.precedingProse);
      }
    }
  }

  // Parse root block
  const rootBlock = rootBlocks[0];
  const rootParseResult = parseAsciiBoxWithButtons(rootBlock.content, rootBlock.line);

  if (rootParseResult.errors.length > 0) {
    errors.push(...rootParseResult.errors.map((e) => ({
      ...e,
      line: e.line ? e.line + rootBlock.line : rootBlock.line,
    })));
    return { errors, warnings, filePath };
  }

  // Collect buttons from root block
  if (rootParseResult.buttons) {
    allButtons.push(...rootParseResult.buttons);
  }

  // Mark boxes as references if they match component IDs
  if (rootParseResult.structure) {
    markComponentReferences(rootParseResult.structure, components);
  }

  // Build render context
  const context = buildRenderContext(blocks, errors, warnings);
  context.components = components;
  context.elementTypes = options?.elementTypes;

  // Add button shortcuts to context
  if (allButtons.length > 0) {
    context.buttonShortcuts = new Map(allButtons.map(b => [b.id, b]));
  }

  // Extract external scripts from ## Scripts section
  const externalScripts = extractScriptsSection(markdown);
  if (externalScripts.length > 0) {
    context.externalScripts = externalScripts;
  }

  // Add prose comments for root and components
  if (rootBlock.precedingProse) {
    context.rootComment = rootBlock.precedingProse;
  }
  context.componentComments = componentComments;

  // Set document title: explicit @title block > displayName > id
  const titleBlock = blocks.find((b) => b.type === 'title');
  if (titleBlock) {
    context.title = titleBlock.content;
  } else if (rootParseResult.structure && rootParseResult.structure.rootBoxes.length > 0) {
    const rootBox = rootParseResult.structure.rootBoxes[0];
    // Use displayName if available, otherwise fall back to id
    context.title = rootBox.displayName || rootBox.id;
  }

  // Resolve references and validate
  if (rootParseResult.structure) {
    validateReferences(rootParseResult.structure, components, errors);
  }

  if (errors.length > 0) {
    return { errors, warnings, filePath };
  }

  // Render to melker XML
  const melker = renderToMelker(rootParseResult.structure!, { includeRoot: true }, context);

  return { melker, errors, warnings, filePath };
}

/**
 * Mark boxes that reference component definitions
 */
function markComponentReferences(
  structure: BoxStructure,
  components: Map<string, BoxStructure>
): void {
  function markBox(box: import('./types.ts').Box): void {
    // If this box ID matches a component and has no children/properties,
    // it's likely a reference
    if (components.has(box.id)) {
      const hasOwnContent = (box.children && box.children.length > 0) ||
        (box.properties && Object.keys(box.properties).length > 0);
      if (!hasOwnContent) {
        box.isReference = true;
      }
    }

    // Process children
    if (box.children) {
      for (const child of box.children) {
        markBox(child);
      }
    }
  }

  for (const rootBox of structure.rootBoxes) {
    // Don't mark the root box itself
    if (rootBox.children) {
      for (const child of rootBox.children) {
        markBox(child);
      }
    }
  }
}

/** Parsed button with its generated ID */
interface ButtonWithId {
  id: string;
  title: string;
  onClick?: string;
}

/**
 * Parse ASCII box content with button shortcut support
 */
function parseAsciiBoxWithButtons(content: string, baseLineNumber: number): ParseResult & { buttons?: ButtonWithId[] } {
  // First, transform button shortcuts into proper boxes
  const { content: transformedContent, buttons } = transformButtonShortcutsWithInfo(content);

  // Parse the transformed content
  const result = parseAsciiBoxes(transformedContent);
  return { ...result, buttons };
}

/**
 * Transform button shortcuts [ Title ] into box syntax and collect button info
 * This is a preprocessing step before parsing
 *
 * IMPORTANT: This does NOT transform brackets that are part of shorthand box syntax:
 *   +--[Button Title]--+  -> This is a shorthand box, NOT a button shortcut
 *   | [ Button Title ] |  -> This IS a button shortcut that gets transformed
 */
function transformButtonShortcutsWithInfo(content: string): { content: string; buttons: ButtonWithId[] } {
  const lines = content.split('\n');
  const result: string[] = [];
  const allButtons: ButtonWithId[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check if line contains button shortcuts
    // Skip if: line starts with + (box definition) OR contains +--[...]--+ (shorthand box syntax)
    // The pattern uses -+ to match one or more dashes (boxes often have many trailing dashes)
    const hasShorthandBox = /\+--\[.+?\]-+\+/.test(line);
    if (line.includes('[') && line.includes(']') && !line.match(/^\s*\+/) && !hasShorthandBox) {
      // Parse buttons from this line
      const buttons = parseButtonShortcuts(line, i);

      if (buttons.length > 0) {
        // Replace button shortcuts with inline box references
        let transformedLine = line;
        for (const button of buttons.reverse()) {
          // Create a button box ID from the button
          const buttonId = button.id ?? `btn_${i}_${button.bounds.left}`;
          const buttonBox = `+--${buttonId}--+`;

          // Store button info for later rendering
          allButtons.push({
            id: buttonId,
            title: button.title,
            onClick: button.onClick,
          });

          // Replace the button shortcut with a reference
          transformedLine =
            transformedLine.substring(0, button.bounds.left) +
            buttonBox +
            transformedLine.substring(button.bounds.right);
        }
        result.push(transformedLine);
      } else {
        result.push(line);
      }
    } else {
      result.push(line);
    }
  }

  return { content: result.join('\n'), buttons: allButtons };
}

function extractCodeBlocks(markdown: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const lines = markdown.split('\n');

  let inCodeBlock = false;
  let currentLang = '';
  let currentLangModifier: string | undefined;
  let currentContent: string[] = [];
  let startLine = 0;
  let proseStartLine = 0; // Track where prose starts (after previous code block)
  let codeBlockStartLine = 0; // Track where current code block fence is

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!inCodeBlock) {
      // Check for code block start - support "```lang modifier" syntax
      const match = line.match(/^```(\S+)(?:\s+(\S+))?/);
      if (match) {
        inCodeBlock = true;
        currentLang = match[1];
        currentLangModifier = match[2];
        currentContent = [];
        codeBlockStartLine = i;
        startLine = i + 1; // 1-indexed line number
      }
    } else {
      // Check for code block end
      if (line.startsWith('```')) {
        // Extract prose between previous block end and this block start
        const proseLines = lines.slice(proseStartLine, codeBlockStartLine);
        const prose = extractProse(proseLines);

        blocks.push({
          lang: currentLang,
          langModifier: currentLangModifier,
          content: currentContent.join('\n'),
          startLine,
          precedingProse: prose || undefined,
        });
        inCodeBlock = false;
        currentLang = '';
        currentLangModifier = undefined;
        currentContent = [];
        proseStartLine = i + 1; // Next prose starts after this code block
      } else {
        currentContent.push(line);
      }
    }
  }

  return blocks;
}

/**
 * Extract meaningful prose from markdown lines.
 * Removes headings, empty lines, markdown links (in list format), and trims the result.
 */
function extractProse(lines: string[]): string {
  const proseLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip empty lines, headings, and horizontal rules
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) continue;
    if (trimmed.match(/^[-=*]{3,}$/)) continue;
    // Skip markdown links in list format (from ## Scripts section)
    if (trimmed.match(/^-?\s*\[.+\]\(.+\)$/)) continue;

    proseLines.push(trimmed);
  }

  return proseLines.join(' ').trim();
}

/**
 * Extract external script links from ## Scripts section in markdown
 * Format: ## Scripts followed by markdown links like - [name](url)
 */
function extractScriptsSection(markdown: string): ExternalScript[] {
  const scripts: ExternalScript[] = [];
  const lines = markdown.split('\n');

  let inScriptsSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Check for ## Scripts heading (case insensitive)
    if (trimmed.match(/^##\s+scripts?\s*$/i)) {
      inScriptsSection = true;
      continue;
    }

    // Stop at next heading or code block
    if (inScriptsSection) {
      if (trimmed.startsWith('#') || trimmed.startsWith('```')) {
        inScriptsSection = false;
        continue;
      }

      // Parse markdown links: - [name](url) or [name](url)
      const linkMatch = trimmed.match(/^-?\s*\[([^\]]+)\]\(([^)]+)\)/);
      if (linkMatch) {
        scripts.push({
          name: linkMatch[1].trim(),
          src: linkMatch[2].trim(),
        });
      }
    }
  }

  return scripts;
}

function categorizeBlocks(codeBlocks: CodeBlock[], errors: ParseError[]): ExtractedBlock[] {
  const blocks: ExtractedBlock[] = [];
  let foundRoot = false;

  for (const block of codeBlocks) {
    const { lang, langModifier, content, startLine } = block;

    // melker-block - First one is root, rest are components
    if (lang === 'melker-block') {
      if (!foundRoot) {
        foundRoot = true;
        blocks.push({
          type: 'root',
          content,
          line: startLine,
          precedingProse: block.precedingProse,
        });
      } else {
        blocks.push({
          type: 'component',
          content,
          line: startLine,
          precedingProse: block.precedingProse,
        });
      }
    }
    // typescript/ts/javascript/js blocks - check for @melker directive
    else if (['typescript', 'ts', 'javascript', 'js'].includes(lang)) {
      const extracted = extractTypeScriptBlock(content, startLine, errors);
      if (extracted) {
        blocks.push(extracted);
      }
    }
    // css blocks - check for @melker style directive
    else if (lang === 'css') {
      const extracted = extractCssBlock(content, startLine);
      if (extracted) {
        blocks.push(extracted);
      }
    }
    // json blocks - check for @target, @name, or oauth modifier
    else if (lang === 'json' || lang === 'jsonc') {
      const extracted = extractJsonBlock(content, startLine, errors, langModifier);
      if (extracted) {
        blocks.push(extracted);
      }
    }
  }

  return blocks;
}

/**
 * Extract melker directive from TypeScript/JavaScript block
 * Supports:
 *   // @melker script           -> sync script (before render)
 *   // @melker script init      -> async init script (before first render)
 *   // @melker script ready     -> async ready script (after first render)
 *   // @melker handler #id.event
 */
function extractTypeScriptBlock(
  content: string,
  startLine: number,
  errors: ParseError[]
): ExtractedBlock | null {
  const lines = content.split('\n');
  const firstLine = lines[0]?.trim() ?? '';

  // Check for @melker directive comment
  const directiveMatch = firstLine.match(/^\/\/\s*@melker\s+(.+)$/);
  if (!directiveMatch) {
    return null; // Not a melker block
  }

  const directive = directiveMatch[1].trim();
  // Remove the directive line from content
  const blockContent = lines.slice(1).join('\n').trim();

  // Parse directive: "script", "script init", "script ready", or "handler #id.event"
  const scriptMatch = directive.match(/^script(?:\s+(init|ready))?$/);
  if (scriptMatch) {
    const asyncType = scriptMatch[1] as 'init' | 'ready' | undefined;
    return {
      type: 'script',
      content: blockContent,
      line: startLine,
      scriptType: asyncType ?? 'sync',
    };
  }

  const handlerMatch = directive.match(/^handler\s+#([^.]+)\.(\w+)$/);
  if (handlerMatch) {
    return {
      type: 'handler',
      elementId: handlerMatch[1],
      event: handlerMatch[2],
      content: blockContent,
      line: startLine,
    };
  }

  errors.push({
    message: `Invalid @melker directive: "${directive}". Expected "script", "script init", "script ready", or "handler #id.event"`,
    line: startLine,
  });
  return null;
}

/**
 * Extract melker directive from CSS block
 * Supports:
 *   /* @melker style */
function extractCssBlock(content: string, startLine: number): ExtractedBlock | null {
  const lines = content.split('\n');
  const firstLine = lines[0]?.trim() ?? '';

  // Check for @melker style directive (CSS comment)
  if (firstLine.match(/^\/\*\s*@melker\s+style\s*\*\/$/)) {
    return {
      type: 'style',
      content: lines.slice(1).join('\n').trim(),
      line: startLine,
    };
  }

  return null; // Not a melker block
}

/**
 * Extract melker metadata from JSON block
 * Supports:
 *   { "@melker": "policy", ... }    -> policy configuration
 *   { "@name": "configName", ... }  -> named JSON data
 *   { "@target": "#id", ... }       -> element properties
 *   ```json oauth``` block          -> OAuth configuration
 */
function extractJsonBlock(
  content: string,
  startLine: number,
  errors: ParseError[],
  langModifier?: string
): ExtractedBlock | null {
  // Handle json oauth blocks
  if (langModifier === 'oauth') {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      errors.push({
        message: `Invalid JSON in oauth block: ${(e as Error).message}`,
        line: startLine,
      });
      return null;
    }
    return {
      type: 'oauth',
      content: JSON.stringify(parsed),
      line: startLine,
    };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content);
  } catch {
    // Not valid JSON, skip (might be intentional non-melker JSON)
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }

  // Check for @melker: "policy" (policy configuration)
  if ('@melker' in parsed && parsed['@melker'] === 'policy') {
    // Remove @melker from the content for storage
    const { '@melker': _, ...rest } = parsed;
    return {
      type: 'policy',
      content: JSON.stringify(rest),
      line: startLine,
    };
  }

  // Check for @title (document title)
  if ('@title' in parsed && typeof parsed['@title'] === 'string') {
    return {
      type: 'title',
      content: parsed['@title'] as string,
      line: startLine,
    };
  }

  // Check for @name (named JSON data)
  if ('@name' in parsed && typeof parsed['@name'] === 'string') {
    const name = parsed['@name'] as string;
    // Remove @name from the content for storage
    const { '@name': _, ...rest } = parsed;
    return {
      type: 'json',
      name,
      content: JSON.stringify(rest),
      line: startLine,
    };
  }

  // Check for @target (element properties)
  if ('@target' in parsed && typeof parsed['@target'] === 'string') {
    const target = parsed['@target'] as string;
    if (!target.startsWith('#')) {
      errors.push({
        message: `@target must start with #, got "${target}"`,
        line: startLine,
      });
      return null;
    }
    const elementId = target.substring(1);
    // Remove @target from the content for storage
    const { '@target': _, ...rest } = parsed;
    return {
      type: 'json-props',
      elementId,
      content: JSON.stringify(rest),
      line: startLine,
    };
  }

  return null; // Not a melker block
}

function buildRenderContext(
  blocks: ExtractedBlock[],
  errors: ParseError[],
  warnings: ParseError[]
): RenderContext {
  const context: RenderContext = {
    handlers: new Map(),
    jsonProperties: new Map(),
    jsonData: new Map(),
  };

  // Process script blocks by type
  const scriptBlocks = blocks.filter((b) => b.type === 'script');
  const syncScripts = scriptBlocks.filter((b) => b.scriptType === 'sync' || !b.scriptType);
  const initScripts = scriptBlocks.filter((b) => b.scriptType === 'init');
  const readyScripts = scriptBlocks.filter((b) => b.scriptType === 'ready');

  if (syncScripts.length > 0) {
    context.scriptContent = syncScripts.map((b) => b.content).join('\n\n');
  }
  if (initScripts.length > 0) {
    context.initScriptContent = initScripts.map((b) => b.content).join('\n\n');
  }
  if (readyScripts.length > 0) {
    context.readyScriptContent = readyScripts.map((b) => b.content).join('\n\n');
  }

  // Process style blocks
  const styleBlocks = blocks.filter((b) => b.type === 'style');
  if (styleBlocks.length > 0) {
    context.styleContent = styleBlocks.map((b) => b.content).join('\n\n');
  }

  // Process handler blocks
  const handlerBlocks = blocks.filter((b) => b.type === 'handler');
  const seenHandlers = new Set<string>();

  for (const block of handlerBlocks) {
    const key = `${block.elementId}.${block.event}`;
    if (seenHandlers.has(key)) {
      errors.push({
        message: ERROR_MESSAGES.duplicateHandlerBlock(block.elementId!, block.event!),
        line: block.line,
      });
      continue;
    }
    seenHandlers.add(key);

    if (!context.handlers!.has(block.elementId!)) {
      context.handlers!.set(block.elementId!, new Map());
    }
    context.handlers!.get(block.elementId!)!.set(block.event!, block.content);
  }

  // Process JSON data blocks (content already validated and @name removed)
  const jsonBlocks = blocks.filter((b) => b.type === 'json');
  for (const block of jsonBlocks) {
    context.jsonData!.set(block.name!, block.content);
  }

  // Process JSON property blocks (content already validated and @target removed)
  const jsonPropsBlocks = blocks.filter((b) => b.type === 'json-props');
  for (const block of jsonPropsBlocks) {
    try {
      const props = JSON.parse(block.content);
      // Merge with existing props (later blocks override earlier)
      const existing = context.jsonProperties!.get(block.elementId!) ?? {};
      context.jsonProperties!.set(block.elementId!, { ...existing, ...props });
    } catch (e) {
      errors.push({
        message: `Invalid JSON for @target "#${block.elementId}": ${(e as Error).message}`,
        line: block.line,
      });
    }
  }

  // Process OAuth blocks
  const oauthBlocks = blocks.filter((b) => b.type === 'oauth');
  if (oauthBlocks.length > 0) {
    // Use the last oauth block if multiple (allows override)
    const lastOauthBlock = oauthBlocks[oauthBlocks.length - 1];
    try {
      context.oauthConfig = JSON.parse(lastOauthBlock.content) as OAuthConfig;
    } catch (e) {
      errors.push({
        message: `Invalid OAuth config: ${(e as Error).message}`,
        line: lastOauthBlock.line,
      });
    }
  }

  // Process policy blocks
  const policyBlocks = blocks.filter((b) => b.type === 'policy');
  if (policyBlocks.length > 0) {
    // Use the last policy block if multiple (allows override)
    const lastPolicyBlock = policyBlocks[policyBlocks.length - 1];
    context.policyContent = lastPolicyBlock.content;
  }

  return context;
}

function validateReferences(
  structure: BoxStructure,
  components: Map<string, BoxStructure>,
  errors: ParseError[]
): void {
  const visited = new Set<string>();

  function checkBox(box: import('./types.ts').Box, path: string[]): void {
    if (box.isReference) {
      // Check for circular reference
      if (path.includes(box.id)) {
        errors.push({
          message: ERROR_MESSAGES.circularReference([...path, box.id]),
        });
        return;
      }

      // Check if reference exists
      if (!components.has(box.id) && !structure.boxes.has(box.id)) {
        errors.push({
          message: ERROR_MESSAGES.missingReference(box.id),
        });
        return;
      }

      // If it's a component reference, validate recursively
      if (components.has(box.id)) {
        const component = components.get(box.id)!;
        for (const rootBox of component.rootBoxes) {
          checkBox(rootBox, [...path, box.id]);
        }
      }
    }

    // Check children
    if (box.children) {
      for (const child of box.children) {
        checkBox(child, path);
      }
    }
  }

  for (const rootBox of structure.rootBoxes) {
    checkBox(rootBox, []);
  }
}

/**
 * Convert markdown file to melker XML string
 */
export function markdownToMelker(
  markdown: string,
  filePath?: string,
  options?: ParseOptions
): string {
  const result = parseMarkdownMelker(markdown, filePath, options);

  if (result.errors.length > 0) {
    const errorMessages = result.errors.map((e) => formatParseError(e, filePath));
    throw new Error(`Failed to parse markdown:\n${errorMessages.join('\n')}`);
  }

  return result.melker!;
}
