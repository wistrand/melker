// Dev Tools overlay management
// Shows dev tools in a modal dialog when F12 is pressed

import { Document } from './document.ts';
import { melker } from './template.ts';
import { Element, hasSubtreeElements } from './types.ts';
import { FocusManager } from './focus.ts';
import { formatPolicy, policyToDenoFlags, formatDenoFlags, type MelkerPolicy, type PolicyConfigProperty } from './policy/mod.ts';
import { getGlobalPerformanceDialog } from './performance-dialog.ts';
import { MelkerConfig } from './config/mod.ts';
import { getLogger, getRecentLogEntries, getGlobalLoggerOptions, type LogEntry } from './logging.ts';
import { Stylesheet } from './stylesheet.ts';


const logger = getLogger('DevTools');

/**
 * Recursively register all elements in a tree with the document
 */
function registerElementsWithDocument(doc: Document, element: Element): void {
  doc.addElement(element);
  if (element.children) {
    for (const child of element.children) {
      registerElementsWithDocument(doc, child);
    }
  }
}

export interface DevToolsDependencies {
  document: Document;
  focusManager: FocusManager | null;
  registerElementTree: (element: Element) => void;
  render: () => void;
  forceRender: () => void;
  autoRender: boolean;
  openAIAssistant?: () => void;
  exit?: () => void;
  getServerUrl?: () => string | undefined;
  getStateObject?: () => Record<string, unknown> | null;
  getBoundElements?: () => Array<{ stateKey: string; elementId: string; elementType: string; twoWay: boolean }> | null;
  getI18nEngine?: () => import('./i18n/i18n-engine.ts').I18nEngine | null;
}

/** System information for the System tab */
export interface SystemInfo {
  // System info
  file: string;
  theme: string;
  logFile: string;
  logLevel: string;
  denoVersion: string;
  platform: string;
  // Remote file approval (for URLs only)
  approvalFile?: string;
  // Script processing
  scriptsCount: number;
  handlersCount: number;
  // Generated TypeScript
  generatedLines: number;
  generatedPreview: string;
  generatedFile: string;
  // Bundle output
  templateLines: number;
  bundledCodeSize: number;
  hasSourceMap: boolean;
  bundleFile: string;
  // Registry
  hasInit: boolean;
  hasReady: boolean;
  registeredHandlers: string[];
}

export interface DevToolsState {
  content: string;
  filePath: string;
  type: 'melker' | 'md' | 'mmd';
  convertedContent?: string;  // For .md/.mmd files: the converted .melker content
  policy?: MelkerPolicy;      // Policy if present
  appDir?: string;            // App directory for resolving policy paths
  sourceUrl?: string;         // Source URL for remote apps (for "samesite" net permission)
  systemInfo?: SystemInfo;    // System info if available
  helpContent?: string;       // Help text content (markdown)
}

export class DevToolsManager {
  private _overlay?: Element;
  private _state?: DevToolsState;
  private _deps: DevToolsDependencies;
  private _inspectElementMap: Map<string, Element> = new Map();
  private _inspectSelectedElement?: Element;

  constructor(deps: DevToolsDependencies) {
    this._deps = deps;
  }

  /**
   * Set the source content to display
   */
  setSource(content: string, filePath: string, type: 'melker' | 'md' | 'mmd', convertedContent?: string, policy?: MelkerPolicy, appDir?: string, sourceUrl?: string, systemInfo?: SystemInfo, helpContent?: string): void {
    this._state = { content, filePath, type, convertedContent, policy, appDir, sourceUrl, systemInfo, helpContent };
  }

  /**
   * Check if dev tools overlay is open
   */
  isOpen(): boolean {
    return this._overlay !== undefined;
  }

  /**
   * Get the overlay element
   */
  getOverlay(): Element | undefined {
    return this._overlay;
  }

  /**
   * Toggle Dev Tools overlay (F12)
   */
  toggle(): void {
    if (this._overlay) {
      this.close();
      return;
    }

    if (!this._state?.content) {
      return;
    }

    this._open();
  }

  show(): void {
    if (!this._overlay && this._state?.content) {
      this._open();
    }
  }

  hide(): void {
    this.close();
  }

  /**
   * Open Dev Tools overlay
   */
  private _open(): void {
    if (!this._state) return;

    const filename = this._state.filePath
      ? this._state.filePath.split('/').pop() || 'source'
      : 'source';

    const onClose = () => this.close();
    const onAIAssistant = () => {
      this.close();
      if (this._deps.openAIAssistant) {
        this._deps.openAIAssistant();
      }
    };
    const onExit = () => {
      if (this._deps.exit) {
        this._deps.exit();
      }
    };
    const onPerformance = () => {
      this.close();
      getGlobalPerformanceDialog().show();
      this._deps.render();
    };

    const scrollStyle = { flex: 1, padding: 1, overflow: 'scroll', width: 'fill', height: 'fill' };

    // Build tabs array in order: Help (if present), Source, Policy (if present), Markdown (if .md file), System, Actions
    const tabs: Element[] = [];

    // Tab 0: Source (Melker source or converted content for .md/.mmd files)
    const sourceContent = (this._state.type === 'md' || this._state.type === 'mmd') && this._state.convertedContent
      ? this._state.convertedContent
      : this._state.content;
    tabs.push(melker`
      <tab id="dev-tools-tab-melker" title="Source">
        <container id="dev-tools-scroll-melker" scrollable=${true} focusable=${true} style=${scrollStyle}>
          <text id="dev-tools-melker-content" text=${sourceContent} />
        </container>
      </tab>
    `);

    // Tab 1: Help (if present)
    if (this._state.helpContent) {
      const helpContent = this._state.helpContent;
      tabs.push(melker`
        <tab id="dev-tools-tab-help" title="Help">
          <container id="dev-tools-scroll-help" scrollable=${true} focusable=${true} style=${scrollStyle}>
            <markdown id="dev-tools-help-content" text=${helpContent} style=${{ textWrap: 'wrap' }} />
          </container>
        </tab>
      `);
    }

    // Tab 2: Policy (if present)
    if (this._state.policy) {
      let policyText = formatPolicy(this._state.policy, this._state.sourceUrl);
      const appDir = this._state.appDir || '.';
      const denoFlags = policyToDenoFlags(this._state.policy, appDir, undefined, this._state.sourceUrl);
      if (denoFlags.length > 0) {
        policyText += '\nDeno permission flags:\n';
        policyText += formatDenoFlags(denoFlags);
      }
      tabs.push(melker`
        <tab id="dev-tools-tab-policy" title="Policy">
          <container id="dev-tools-scroll-policy" scrollable=${true} focusable=${true} style=${scrollStyle}>
            <text id="dev-tools-policy-content" text=${policyText} style=${{ textWrap: 'wrap' }} />
          </container>
        </tab>
      `);
    }

    // Tab 3: Markdown (if .md file)
    if (this._state.type === 'md') {
      const mdContent = this._state.content;
      const mdSrc = this._state.filePath;
      tabs.push(melker`
        <tab id="dev-tools-tab-md" title="Markdown">
          <container id="dev-tools-scroll-md" scrollable=${true} focusable=${true} style=${scrollStyle}>
            <markdown id="dev-tools-markdown-content" text=${mdContent} src=${mdSrc} style=${{ textWrap: 'wrap' }} />
          </container>
        </tab>
      `);
    }

    // Tab 3b: Mermaid (if .mmd file)
    if (this._state.type === 'mmd') {
      const mmdContent = this._state.content;
      tabs.push(melker`
        <tab id="dev-tools-tab-mmd" title="Mermaid">
          <container id="dev-tools-scroll-mmd" scrollable=${true} focusable=${true} style=${scrollStyle}>
            <text id="dev-tools-mermaid-content" text=${mmdContent} style=${{ textWrap: 'wrap' }} />
          </container>
        </tab>
      `);
    }

    // Tab 4: System Info (if available)
    if (this._state.systemInfo) {
      const systemText = this._formatSystemInfo(this._state.systemInfo);
      tabs.push(melker`
        <tab id="dev-tools-tab-system" title="System">
          <container id="dev-tools-scroll-system" scrollable=${true} focusable=${true} style=${scrollStyle}>
            <text id="dev-tools-system-content" text=${systemText} style=${{ textWrap: 'wrap' }} />
          </container>
        </tab>
      `);
    }

    // Tab 5: Config
    const configText = MelkerConfig.getConfigText();
    tabs.push(melker`
      <tab id="dev-tools-tab-config" title="Config">
        <container id="dev-tools-scroll-config" scrollable=${true} focusable=${true} style=${scrollStyle}>
          <text id="dev-tools-config-content" text=${configText} style=${{ textWrap: 'wrap' }} />
        </container>
      </tab>
    `);

    // Tab 6: Edit Config (only if policy has configSchema)
    if (this._state.policy?.configSchema) {
      const editConfigTab = this._buildEditConfigTab(this._state.policy.configSchema);
      tabs.push(editConfigTab);
    }

    // Tab 7: CSS Variables
    const varsTab = this._buildVarsTab();
    tabs.push(varsTab);

    // Tab 8: Inspect (document tree view)
    const inspectTab = this._buildInspectTab();
    tabs.push(inspectTab);

    // Tab 9: I18n (locale picker + message keys, only if i18n is active)
    const i18nTab = this._buildI18nTab();
    if (i18nTab) tabs.push(i18nTab);

    // Tab 10: State (createState values, only if state exists)
    const stateTab = this._buildStateTab();
    if (stateTab) tabs.push(stateTab);

    // Tab 11: Log (recent log entries)
    const logTab = this._buildLogTab();
    tabs.push(logTab);

    // Tab 9: Actions
    tabs.push(melker`
      <tab id="dev-tools-tab-actions" title="Actions">
        <container id="dev-tools-actions-content" style=${{ flex: 1, padding: 1, width: 'fill', height: 'fill', display: 'flex', flexDirection: 'column', gap: 1 }}>
          <button id="dev-tools-action-perf" label="Performance Monitor" onClick=${onPerformance} />
          <button id="dev-tools-action-exit" label="Exit Application" onClick=${onExit} />
        </container>
      </tab>
    `);

    // Build the dialog with tabs
    const tabsStyle = { flex: 1, width: 'fill', height: 'fill' };
    const mainStyle = { display: 'flex', flexDirection: 'column', width: 'fill', height: 'fill' };
    const footerStyle = { display: 'flex', flexDirection: 'row', justifyContent: 'flex-end', width: 'fill', gap: 1 };

    this._overlay = melker`
      <dialog id="dev-tools-dialog" title=${`Dev Tools - ${filename}`} open=${true} modal=${true} backdrop=${false} width=${0.9} height=${0.85}>
        <container id="dev-tools-main" style=${mainStyle}>
          <tabs id="dev-tools-tabs" style=${tabsStyle}>
            ${tabs}
          </tabs>
          <container id="dev-tools-footer" style=${footerStyle}>
            <button id="dev-tools-ai" label="AI Assistant" onClick=${onAIAssistant} />
            <button id="dev-tools-close" label="Close" onClick=${onClose} />
          </container>
        </container>
      </dialog>
    `;

    // Add to document and register all elements
    const root = this._deps.document.root;
    if (root.children) {
      root.children.push(this._overlay);
    }
    this._deps.registerElementTree(this._overlay);

    // Also register with document's element registry for getElementById() to work
    registerElementsWithDocument(this._deps.document, this._overlay);

    // Force render to ensure clean display (dirty row tracking can miss rows)
    if (this._deps.autoRender) {
      this._deps.forceRender();
    }

    // Focus the first scroll container for arrow key navigation
    if (this._deps.focusManager) {
      const firstTabScrollId = this._state.helpContent ? 'dev-tools-scroll-help' : 'dev-tools-scroll-melker';
      this._deps.focusManager.focus(firstTabScrollId);
    }
  }

  /**
   * Format system info for display
   */
  private _formatSystemInfo(info: SystemInfo): string {
    const lines: string[] = [];
    const sep = '-'.repeat(40);

    lines.push('SYSTEM INFO');
    lines.push(sep);
    lines.push(`  File:       ${info.file}`);
    lines.push(`  Theme:      ${info.theme}`);
    lines.push(`  Log file:   ${info.logFile}`);
    lines.push(`  Log level:  ${info.logLevel}`);
    lines.push(`  Deno:       ${info.denoVersion}`);
    lines.push(`  Platform:   ${info.platform}`);
    if (info.approvalFile) {
      lines.push(`  Approval:   ${info.approvalFile}`);
    }
    lines.push('');

    // Server info (dynamically retrieved via callback)
    const serverUrl = this._deps.getServerUrl?.();
    if (serverUrl) {
      lines.push('SERVER');
      lines.push(sep);
      lines.push(`  Status:     Running`);
      lines.push(`  URL:        ${serverUrl}`);
      lines.push('');
    }

    lines.push('SCRIPT PROCESSING');
    lines.push(sep);
    lines.push(`  Scripts:    ${info.scriptsCount}`);
    lines.push(`  Handlers:   ${info.handlersCount}`);
    lines.push('');

    lines.push('GENERATED TYPESCRIPT');
    lines.push(sep);
    lines.push(`  Lines:      ${info.generatedLines}`);
    lines.push(`  File:       ${info.generatedFile}`);
    lines.push(`  Preview:    ${info.generatedPreview}`);
    lines.push('');

    lines.push('BUNDLE OUTPUT');
    lines.push(sep);
    lines.push(`  Template lines:     ${info.templateLines}`);
    lines.push(`  Bundled code size:  ${info.bundledCodeSize} bytes`);
    lines.push(`  Source map:         ${info.hasSourceMap ? 'present' : 'none'}`);
    lines.push(`  Bundle file:        ${info.bundleFile}`);
    lines.push('');

    lines.push('REGISTRY');
    lines.push(sep);
    lines.push(`  __init:     ${info.hasInit ? 'present' : 'none'}`);
    lines.push(`  __ready:    ${info.hasReady ? 'present' : 'none'}`);
    lines.push(`  Handlers:   ${info.registeredHandlers.length > 0 ? info.registeredHandlers.join(', ') : 'none'}`);

    return lines.join('\n');
  }

  /**
   * Build the CSS Variables tab showing all active variables from stylesheets
   */
  private _buildVarsTab(): Element {
    const document = this._deps.document;
    const render = () => this._deps.render();

    const columns = [
      { header: 'Variable', width: 30 },
      { header: 'Value' },
      { header: 'Source', width: 20 },
    ];

    const generateRows = (): string[][] => {
      // Start with theme vars as baseline (always visible)
      const { vars: themeVars, origins: themeOrigins } = Stylesheet._buildThemeVars();
      const allVars = new Map(themeVars);
      const allOrigins = new Map(themeOrigins);
      // Overlay stylesheet variables (user-defined override theme defaults)
      for (const sheet of document.stylesheets) {
        for (const [key, value] of sheet.variables) {
          allVars.set(key, value);
        }
        for (const [key, origin] of sheet.variableOrigins) {
          allOrigins.set(key, origin);
        }
      }
      // Sort: user vars first alphabetically, then theme vars
      const entries = [...allVars.entries()];
      entries.sort((a, b) => {
        const aIsTheme = a[0].startsWith('--theme-');
        const bIsTheme = b[0].startsWith('--theme-');
        if (aIsTheme !== bIsTheme) return aIsTheme ? 1 : -1;
        return a[0].localeCompare(b[0]);
      });
      return entries.map(([name, value]) => [name, value, allOrigins.get(name) ?? '']);
    };

    const rows = generateRows();

    const onRefresh = () => {
      const tableEl = document.getElementById('dev-tools-vars-table');
      if (tableEl) {
        tableEl.props.rows = generateRows();
        render();
      }
    };

    const varCount = rows.length;
    const themeCount = rows.filter(r => r[0].startsWith('--theme-')).length;
    const userCount = varCount - themeCount;

    return melker`
      <tab id="dev-tools-tab-vars" title="Vars">
        <container style=${{ display: 'flex', flexDirection: 'column', width: 'fill', height: 'fill' }}>
          <data-table
            id="dev-tools-vars-table"
            columns=${columns}
            rows=${rows}
            style=${{ flex: 1, width: 'fill', height: 'fill' }}
          />
          <container style=${{ display: 'flex', flexDirection: 'row', padding: 1, gap: 2, alignItems: 'center' }}>
            <text text=${`${varCount} variables (${userCount} user, ${themeCount} theme)`} style=${{ flex: 1, color: 'gray' }} />
            <button id="dev-tools-refresh-vars" label="Refresh" onClick=${onRefresh} />
          </container>
        </container>
      </tab>
    `;
  }

  /**
   * Build the I18n tab showing locale picker and flattened message keys.
   * Returns null if no i18n engine is active.
   */
  private _buildI18nTab(): Element | null {
    const i18n = this._deps.getI18nEngine?.();
    if (!i18n) return null;

    const document = this._deps.document;
    const render = () => this._deps.render();

    const columns = [
      { header: 'Key', width: 30 },
      { header: 'Value' },
    ];

    const generateRows = (): string[][] => {
      const catalog = (i18n as any)._catalogs.get(i18n.locale) as Map<string, string> | undefined;
      if (!catalog) return [];
      return [...catalog.entries()]
        .filter(([key]) => !key.startsWith('_'))
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([key, value]) => [key, value]);
    };

    const rows = generateRows();

    const generateLocaleOptions = () => {
      return i18n.availableLocales.map(l => ({
        id: l,
        label: `${i18n.getLanguageName(l)} (${l})`,
      }));
    };

    const onLocaleChange = async (event: { value: string }) => {
      await i18n.setLocale(event.value);
      // Update table with new locale's messages
      const tableEl = document.getElementById('dev-tools-i18n-table');
      if (tableEl) {
        const newRows = generateRows();
        tableEl.props.rows = newRows;
        // Update footer count
        const countEl = document.getElementById('dev-tools-i18n-count');
        if (countEl) countEl.props.text = `${newRows.length} keys - locale: ${i18n.locale}`;
      }
      render();
    };

    const onRefresh = () => {
      const tableEl = document.getElementById('dev-tools-i18n-table');
      if (tableEl) {
        const newRows = generateRows();
        tableEl.props.rows = newRows;
        const countEl = document.getElementById('dev-tools-i18n-count');
        if (countEl) countEl.props.text = `${newRows.length} keys - locale: ${i18n.locale}`;
        render();
      }
    };

    return melker`
      <tab id="dev-tools-tab-i18n" title="I18n">
        <container style=${{ display: 'flex', flexDirection: 'column', width: 'fill', height: 'fill' }}>
          <data-table
            id="dev-tools-i18n-table"
            columns=${columns}
            rows=${rows}
            style=${{ flex: 1, width: 'fill', height: 'fill' }}
          />
          <container style=${{ display: 'flex', flexDirection: 'row', padding: 1, gap: 2, alignItems: 'center' }}>
            <select id="dev-tools-i18n-locale" onChange=${onLocaleChange} style=${{ width: 24 }} options=${generateLocaleOptions()} selectedValue=${i18n.locale} />
            <text id="dev-tools-i18n-count" text=${`${rows.length} keys - locale: ${i18n.locale}`} style=${{ flex: 1, color: 'gray' }} />
            <button id="dev-tools-refresh-i18n" label="Refresh" onClick=${onRefresh} />
          </container>
        </container>
      </tab>
    `;
  }

  /**
   * Build the State tab showing createState() values.
   * Returns null if no state object is registered.
   */
  private _buildStateTab(): Element | null {
    const stateObject = this._deps.getStateObject?.();
    if (!stateObject) return null;

    const document = this._deps.document;
    const render = () => this._deps.render();

    const columns = [
      { header: 'Name', width: 20 },
      { header: 'Value' },
      { header: 'Bound To', width: 16 },
      { header: 'Role', width: 8 },
    ];

    const generateRows = (): string[][] => {
      const state = this._deps.getStateObject?.();
      if (!state) return [];
      const bound = this._deps.getBoundElements?.() ?? [];
      const boundMap = new Map<string, { target: string; twoWay: boolean }>();
      for (const b of bound) {
        boundMap.set(b.stateKey, { target: b.elementId ? `#${b.elementId}` : b.elementType, twoWay: b.twoWay });
      }
      return Object.keys(state).map(key => {
        const value = state[key];
        const info = boundMap.get(key);
        const boundTo = info?.target ?? '';
        const role = typeof value === 'boolean' ? 'class' : info ? (info.twoWay ? 'bind 2w' : 'bind 1w') : '';
        return [key, JSON.stringify(value), boundTo, role];
      });
    };

    const rows = generateRows();

    const onRefresh = () => {
      const tableEl = document.getElementById('dev-tools-state-table');
      if (tableEl) {
        tableEl.props.rows = generateRows();
        render();
      }
    };

    const totalCount = rows.length;
    const classCount = rows.filter(r => r[3] === 'class').length;
    const bind2wCount = rows.filter(r => r[3] === 'bind 2w').length;
    const bind1wCount = rows.filter(r => r[3] === 'bind 1w').length;
    const bindSummary = bind1wCount > 0 ? `${bind2wCount} bind 2w, ${bind1wCount} bind 1w` : `${bind2wCount} bind`;

    return melker`
      <tab id="dev-tools-tab-state" title="State">
        <container style=${{ display: 'flex', flexDirection: 'column', width: 'fill', height: 'fill' }}>
          <data-table
            id="dev-tools-state-table"
            columns=${columns}
            rows=${rows}
            style=${{ flex: 1, width: 'fill', height: 'fill' }}
          />
          <container style=${{ display: 'flex', flexDirection: 'row', padding: 1, gap: 2, alignItems: 'center' }}>
            <text text=${`${totalCount} keys (${classCount} class, ${bindSummary})`} style=${{ flex: 1, color: 'gray' }} />
            <button id="dev-tools-refresh-state" label="Refresh" onClick=${onRefresh} />
          </container>
        </container>
      </tab>
    `;
  }

  /**
   * Build the Log tab showing recent log entries
   */
  private _buildLogTab(): Element {
    const document = this._deps.document;
    const render = () => this._deps.render();

    const columns = [
      { header: 'Time', width: 12 },
      { header: 'Level', width: 5 },
      { header: 'Source', width: 20 },
      { header: 'Message' },
    ];

    const generateRows = (): (string | null)[][] => {
      const entries = getRecentLogEntries();
      return entries.map(entry => [
        entry.timestamp.toISOString().slice(11, 23), // HH:MM:SS.mmm
        entry.level,
        entry.source || '',
        entry.message + (entry.context && Object.keys(entry.context).length > 0
          ? ' | ' + Object.entries(entry.context).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')
          : '') + (entry.error ? ` | Error: ${entry.error.message}` : ''),
      ]);
    };

    const rows = generateRows();

    // Refresh button handler
    const onRefresh = () => {
      const tableEl = document.getElementById('dev-tools-log-table');
      if (tableEl) {
        tableEl.props.rows = generateRows();
        render();
      }
    };

    const { logFile } = getGlobalLoggerOptions();

    return melker`
      <tab id="dev-tools-tab-log" title="Log">
        <container style=${{ display: 'flex', flexDirection: 'column', width: 'fill', height: 'fill' }}>
          <data-table
            id="dev-tools-log-table"
            columns=${columns}
            rows=${rows}
            style=${{ flex: 1, width: 'fill', height: 'fill' }}
          />
          <container style=${{ display: 'flex', flexDirection: 'row', padding: 1, gap: 2, alignItems: 'center' }}>
            <text text=${`Log file: ${logFile}`} style=${{ flex: 1, color: 'gray' }} />
            <button id="dev-tools-refresh-log" label="Refresh" onClick=${onRefresh} />
          </container>
        </container>
      </tab>
    `;
  }

  /**
   * Build the Edit Config tab with inputs for each configSchema property
   */
  private _buildEditConfigTab(configSchema: Record<string, PolicyConfigProperty>): Element {
    const config = MelkerConfig.get();
    const document = this._deps.document;
    const render = () => this._deps.render();

    // Build input elements for each config property
    const inputs: Element[] = [];
    const inputIds: { key: string; id: string; type: string }[] = [];

    for (const [key, prop] of Object.entries(configSchema)) {
      const type = prop.type || 'string';
      const envVar = prop.env ? ` (${prop.env})` : '';
      const inputId = 'edit-config-' + key.replace(/\./g, '-');
      inputIds.push({ key, id: inputId, type });
      logger.debug(`Creating input for config key=${key}, id=${inputId}, type=${type}`);

      // Create appropriate input based on type
      if (type === 'boolean') {
        const checked = config.getBoolean(key, prop.default as boolean ?? false);
        inputs.push(melker`
          <container style=${{ display: 'flex', flexDirection: 'row', gap: 1, marginBottom: 1 }}>
            <checkbox id=${inputId} checked=${checked} />
            <text text=${`${key}${envVar}`} style=${{ flex: 1 }} />
          </container>
        `);
      } else if (type === 'number' || type === 'integer') {
        const value = config.getNumber(key, prop.default as number ?? 0);
        // Use slider if min/max are defined, otherwise use input
        if (prop.min !== undefined && prop.max !== undefined) {
          const step = prop.step ?? (type === 'integer' ? 1 : undefined);
          inputs.push(melker`
            <container style=${{ display: 'flex', flexDirection: 'row', gap: 1, marginBottom: 1 }}>
              <text text=${key + envVar + ':'} style=${{ width: 20 }} />
              <slider id=${inputId} min=${prop.min} max=${prop.max} step=${step} value=${value} showValue=${true} style=${{ flex: 1 }} />
            </container>
          `);
        } else {
          inputs.push(melker`
            <container style=${{ display: 'flex', flexDirection: 'row', gap: 1, marginBottom: 1 }}>
              <text text=${key + envVar + ':'} style=${{ width: 20 }} />
              <input id=${inputId} value=${String(value)} style=${{ flex: 1 }} />
            </container>
          `);
        }
      } else {
        // String type
        const value = config.getString(key, prop.default as string ?? '');
        inputs.push(melker`
          <container style=${{ display: 'flex', flexDirection: 'row', gap: 1, marginBottom: 1 }}>
            <text text=${key + envVar + ':'} style=${{ width: 20 }} />
            <input id=${inputId} value=${value} style=${{ flex: 1 }} />
          </container>
        `);
      }

      if (prop.description) {
        inputs.push(melker`<text text=${'  ' + prop.description} style=${{ color: 'gray', marginBottom: 1 }} />`);
      }
    }

    // Update button handler - reads all input values and updates config
    const onUpdate = () => {
      logger.info('Update button clicked, reading values from inputs...');
      // Log all registered element IDs for debugging
      const allIds = Array.from(document.getAllElements()).map(e => e.id).filter(Boolean);
      logger.debug(`Registered element IDs: ${allIds.join(', ')}`);

      for (const { key, id, type } of inputIds) {
        const element = document.getElementById(id);
        logger.debug(`Looking up element id=${id}, found=${!!element}`);
        if (!element) continue;

        if (type === 'boolean') {
          const checked = (element.props as { checked?: boolean }).checked ?? false;
          logger.info(`Checkbox ${id}: checked=${checked}`);
          config.setValue(key, checked);
        } else if (type === 'number' || type === 'integer') {
          // Check if it's a slider or input
          const props = element.props as { value?: string | number };
          const rawValue = props.value;
          logger.info(`Number input ${id}: props.value="${rawValue}", type=${element.type}, props keys=${Object.keys(props).join(',')}`);

          // Slider stores numeric value, input stores string
          let num: number;
          if (typeof rawValue === 'number') {
            num = rawValue;
          } else {
            const strValue = rawValue ?? '';
            num = type === 'integer' ? parseInt(strValue, 10) : parseFloat(strValue);
          }

          if (!isNaN(num)) {
            config.setValue(key, num);
          } else {
            logger.warn(`Failed to parse "${rawValue}" as ${type}`);
          }
        } else {
          const props = element.props as { value?: string };
          logger.info(`Input ${id}: props.value="${props.value}"`);
          const value = props.value ?? '';
          config.setValue(key, value);
        }
      }
      render();
    };

    const scrollStyle = { flex: 1, padding: 1, overflow: 'scroll', width: 'fill', height: 'fill' };

    return melker`
      <tab id="dev-tools-tab-edit-config" title="Edit Config">
        <container style=${{ display: 'flex', flexDirection: 'column', width: 'fill', height: 'fill' }}>
          <container id="dev-tools-scroll-edit-config" scrollable=${true} focusable=${true} style=${scrollStyle}>
            <text text="Edit app config values at runtime:" style=${{ marginBottom: 1, fontWeight: 'bold' }} />
            ${inputs}
          </container>
          <container style=${{ padding: 1 }}>
            <button id="dev-tools-update-config" label="Update" onClick=${onUpdate} />
          </container>
        </container>
      </tab>
    `;
  }

  /** Max number of editor rows in each pool (one text input per row) */
  /** Props to skip in the editor (non-editable, internal, or handled elsewhere) */
  private static _skipEditProps = new Set([
    'style', 'classList', 'children', 'id', 'class', 'tabIndex',
    'bind', 'bind-mode', 'bind:selection', 'persist',
    'role', 'aria-label', 'aria-labelledby', 'aria-hidden', 'aria-description',
    'aria-expanded', 'aria-controls', 'aria-busy', 'aria-required', 'aria-invalid',
    'palette', 'palette-shortcut', 'palette-group',
    'tooltip', 'onTooltip',
  ]);

  /** Current editor prop/style names, set by _updateInspectDetail */
  private _propEditorAssignments: string[] = [];
  private _styleEditorAssignments: string[] = [];

  /**
   * Build the Inspect tab showing interactive document tree with detail panel.
   * All elements are created upfront; selection updates props only.
   */
  private _buildInspectTab(): Element {
    const document = this._deps.document;
    const render = () => this._deps.render();

    const buildNodes = (): { nodes: Record<string, unknown>[]; map: Map<string, Element> } => {
      const map = new Map<string, Element>();
      const root = document.root;
      if (!root) return { nodes: [], map };
      const rootNode = this._buildElementNode(root, 0, root.type, map);
      return { nodes: rootNode ? [rootNode] : [], map };
    };

    const { nodes, map } = buildNodes();
    this._inspectElementMap = map;


    const onSelect = (event: { nodeId: string; selectedNodes: string[] }) => {
      const nodeId = event.selectedNodes?.[0] || event.nodeId;
      const element = this._inspectElementMap.get(nodeId);
      if (element) {
        this._inspectSelectedElement = element;
        this._updateInspectDetail(element);
      }
    };

    const onRefresh = () => {
      const { nodes: newNodes, map: newMap } = buildNodes();
      this._inspectElementMap = newMap;
      const treeEl = document.getElementById('dev-tools-inspect-tree');
      if (treeEl) {
        treeEl.props.nodes = newNodes;
        if (this._inspectSelectedElement) {
          const selId = this._inspectSelectedElement.id;
          const newEl = selId ? newMap.get(selId) : undefined;
          if (newEl) {
            this._inspectSelectedElement = newEl;
            this._updateInspectDetail(newEl);
          }
        }
        render();
      }
    };

    const detailStyle = { padding: 1, overflow: 'scroll', width: 'fill', height: 'fill' };

    return melker`
      <tab id="dev-tools-tab-inspect" title="Inspect">
        <container style=${{ display: 'flex', flexDirection: 'column', width: 'fill', height: 'fill' }}>
          <split-pane id="dev-tools-inspect-split" sizes=${[2, 3]} style=${{ flex: 1, width: 'fill', height: 'fill' }}>
            <data-tree
              id="dev-tools-inspect-tree"
              nodes=${nodes}
              selectable="single"
              onChange=${onSelect}
              style=${{ width: 'fill', height: 'fill' }}
            />
            <container id="dev-tools-inspect-detail" scrollable=${true} focusable=${true} style=${detailStyle}>
              <text text="Select an element to inspect" style=${{ color: 'gray' }} />
            </container>
          </split-pane>
          <container style=${{ display: 'flex', flexDirection: 'row', padding: 1, gap: 2, justifyContent: 'flex-end' }}>
            <button id="dev-tools-refresh-inspect" label="Refresh" onClick=${onRefresh} />
          </container>
        </container>
      </tab>
    `;
  }

  /**
   * Recursively build a tree node for the inspect data-tree, skipping dev-tools elements.
   * Populates the element lookup map for O(1) access on selection.
   */
  private _buildElementNode(
    element: Element,
    depth: number,
    pathKey: string,
    map: Map<string, Element>,
    isSubtree: boolean = false,
  ): Record<string, unknown> | null {
    if (element.id?.startsWith('dev-tools-')) return null;

    // Build label: type#id.class1.class2
    let label = element.type;
    if (element.id && !element.id.startsWith('el-')) {
      label += `#${element.id}`;
    }
    const classList = element.props?.classList as string[] | undefined;
    if (classList?.length) {
      label += classList.map((c: string) => `.${c}`).join('');
    }
    if (isSubtree) label = `(subtree) ${label}`;

    // Use explicit id if it's a user-set id, otherwise use the path key
    const nodeId = (element.id && !element.id.startsWith('el-')) ? element.id : pathKey;
    map.set(nodeId, element);

    // Build children
    const filteredChildren = (element.children || []).filter(c => !c.id?.startsWith('dev-tools-'));
    const subtreeElements: Element[] = hasSubtreeElements(element)
      ? element.getSubtreeElements()
      : [];

    const children: Record<string, unknown>[] = [];
    filteredChildren.forEach((child, i) => {
      const childKey = `${nodeId}/${child.type}-${i}`;
      const node = this._buildElementNode(child, depth + 1, childKey, map);
      if (node) children.push(node);
    });
    subtreeElements.forEach((child, i) => {
      const childKey = `${nodeId}/~${child.type}-${i}`;
      const node = this._buildElementNode(child, depth + 1, childKey, map, true);
      if (node) children.push(node);
    });

    const result: Record<string, unknown> = {
      label,
      id: nodeId,
      expanded: depth < 2,
    };
    if (children.length > 0) result.children = children;
    return result;
  }

  /**
   * Rebuild the inspect detail panel children for the selected element.
   */
  private _updateInspectDetail(element: Element): void {
    const document = this._deps.document;
    const render = () => this._deps.render();

    const detailContainer = document.getElementById('dev-tools-inspect-detail');
    if (!detailContainer) return;

    // --- Identity ---
    let identity = element.type;
    if (element.id && !element.id.startsWith('el-')) identity += `#${element.id}`;
    const classList = element.props?.classList as string[] | undefined;
    if (classList?.length) identity += classList.map((c: string) => `.${c}`).join('');
    const flags: string[] = [];
    if (document.focusedElement === element) flags.push('focused');
    if (element.props?.visible === false) flags.push('hidden');
    if (flags.length) identity += `  (${flags.join(', ')})`;

    // --- Bounds ---
    const bounds = element.getBounds();
    const boundsText = bounds
      ? `Position: x=${bounds.x}, y=${bounds.y}  Size: ${bounds.width} x ${bounds.height}`
      : 'Bounds: not laid out';

    // --- Collect editable props ---
    const skipEdit = DevToolsManager._skipEditProps;
    const propNames: string[] = [];
    for (const key of Object.keys(element.props || {})) {
      if (skipEdit.has(key) || key.startsWith('on') || key.startsWith('__')) continue;
      const val = element.props[key];
      if (val === undefined || typeof val === 'object' || typeof val === 'function') continue;
      propNames.push(key);
    }
    this._propEditorAssignments = propNames;

    // --- Collect style properties ---
    const style = element.props?.style as Record<string, unknown> | undefined;
    const styleNames: string[] = [];
    if (style) {
      for (const [key, val] of Object.entries(style)) {
        if (val === undefined) continue;
        styleNames.push(key);
      }
    }
    this._styleEditorAssignments = styleNames;

    // --- Helpers ---
    const parseValue = (raw: unknown): unknown => {
      if (raw === undefined || raw === null || raw === '') return undefined;
      const s = String(raw);
      if (s === 'true') return true;
      if (s === 'false') return false;
      const num = Number(s);
      if (!isNaN(num) && s.trim() !== '' && String(num) === s.trim()) return num;
      return s;
    };

    const onApplyProps = () => {
      if (!this._inspectSelectedElement) return;
      for (let i = 0; i < this._propEditorAssignments.length; i++) {
        const prop = this._propEditorAssignments[i];
        const el = document.getElementById(`dev-tools-inspect-editprop-input-${i}`);
        if (!el) continue;
        const newValue = parseValue(el.props.value);
        if (newValue !== undefined && newValue !== this._inspectSelectedElement.props[prop]) {
          this._inspectSelectedElement.props[prop] = newValue;
        }
      }
      const nameEl = document.getElementById('dev-tools-inspect-addprop-name');
      const valEl = document.getElementById('dev-tools-inspect-addprop-value');
      if (nameEl && valEl) {
        const name = String(nameEl.props.value || '').trim();
        const newVal = parseValue(valEl.props.value);
        if (name && newVal !== undefined) {
          this._inspectSelectedElement.props[name] = newVal;
        }
      }
      render();
      if (this._inspectSelectedElement) this._updateInspectDetail(this._inspectSelectedElement);
    };

    const onApplyStyle = () => {
      if (!this._inspectSelectedElement) return;
      const currentStyle = this._inspectSelectedElement.props.style as Record<string, unknown> || {};
      if (!this._inspectSelectedElement.props.style) {
        this._inspectSelectedElement.props.style = currentStyle;
      }
      for (let i = 0; i < this._styleEditorAssignments.length; i++) {
        const prop = this._styleEditorAssignments[i];
        const el = document.getElementById(`dev-tools-inspect-editstyle-input-${i}`);
        if (!el) continue;
        const newValue = parseValue(el.props.value);
        if (newValue !== undefined && newValue !== currentStyle[prop]) {
          currentStyle[prop] = newValue;
        }
      }
      const nameEl = document.getElementById('dev-tools-inspect-addstyle-name');
      const valEl = document.getElementById('dev-tools-inspect-addstyle-value');
      if (nameEl && valEl) {
        const name = String(nameEl.props.value || '').trim();
        const newVal = parseValue(valEl.props.value);
        if (name && newVal !== undefined) {
          currentStyle[name] = newVal;
        }
      }
      render();
      if (this._inspectSelectedElement) this._updateInspectDetail(this._inspectSelectedElement);
    };

    // --- Build children ---
    const headerStyle = { fontWeight: 'bold', marginTop: 1 };
    const newChildren: Element[] = [
      melker`<text text=${identity} style=${{ fontWeight: 'bold' }} />`,
      melker`<text text=${boundsText} style=${{ color: 'gray' }} />`,
    ];

    if (propNames.length > 0) {
      const propRows = propNames.map((prop, i) => {
        const val = element.props[prop];
        return melker`
          <container style=${{ flexDirection: 'row', gap: 1 }}>
            <text id=${`dev-tools-inspect-editprop-label-${i}`} text=${prop + ':'} style=${{ width: 18 }} />
            <input id=${`dev-tools-inspect-editprop-input-${i}`} value=${val != null ? String(val) : ''} style=${{ flex: 1 }} />
          </container>
        `;
      });
      newChildren.push(melker`
        <container>
          <text text="Props" style=${headerStyle} />
          ${propRows}
          <container style=${{ display: 'flex', flexDirection: 'row', gap: 1 }}>
            <input id="dev-tools-inspect-addprop-name" value="" placeholder="property" style=${{ width: 18 }} />
            <input id="dev-tools-inspect-addprop-value" value="" placeholder="value" style=${{ flex: 1 }} />
          </container>
          <button id="dev-tools-inspect-apply-props" label="Apply Props" onClick=${onApplyProps} />
        </container>
      `);
    }

    const styleRows = styleNames.map((prop, i) => {
      const val = style?.[prop];
      return melker`
        <container style=${{ flexDirection: 'row', gap: 1 }}>
          <text id=${`dev-tools-inspect-editstyle-label-${i}`} text=${prop + ':'} style=${{ width: 22 }} />
          <input id=${`dev-tools-inspect-editstyle-input-${i}`} value=${val != null ? String(val) : ''} style=${{ flex: 1 }} />
        </container>
      `;
    });
    newChildren.push(melker`
      <container>
        <text text="Style" style=${headerStyle} />
        ${styleRows}
        <container style=${{ display: 'flex', flexDirection: 'row', gap: 1 }}>
          <input id="dev-tools-inspect-addstyle-name" value="" placeholder="property" style=${{ width: 22 }} />
          <input id="dev-tools-inspect-addstyle-value" value="" placeholder="value" style=${{ flex: 1 }} />
        </container>
        <button id="dev-tools-inspect-apply" label="Apply Style" onClick=${onApplyStyle} />
      </container>
    `);

    // Replace children and register new elements with document
    detailContainer.children = newChildren;
    for (const child of newChildren) {
      registerElementsWithDocument(document, child);
    }

    render();
  }

  /**
   * Close Dev Tools overlay
   */
  close(): void {
    if (!this._overlay) return;

    // Remove from document root's children
    const root = this._deps.document.root;
    if (root.children) {
      const index = root.children.indexOf(this._overlay);
      if (index !== -1) {
        root.children.splice(index, 1);
      }
    }

    // Unregister all elements from document registry
    this._deps.document.removeElement(this._overlay);

    this._overlay = undefined;

    // Force complete redraw since overlay covered the screen
    this._deps.forceRender();
  }
}
