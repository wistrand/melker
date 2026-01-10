// Dev Tools overlay management
// Shows dev tools in a modal dialog when F12 is pressed

import { Document } from './document.ts';
import { melker } from './template.ts';
import { Element } from './types.ts';
import { FocusManager } from './focus.ts';
import { formatPolicy, policyToDenoFlags, formatDenoFlags, type MelkerPolicy } from './policy/mod.ts';
import { getGlobalPerformanceDialog } from './performance-dialog.ts';
import { MelkerConfig } from './config/mod.ts';

export interface DevToolsDependencies {
  document: Document;
  focusManager: FocusManager | null;
  registerElementTree: (element: Element) => void;
  render: () => void;
  forceRender: () => void;
  autoRender: boolean;
  openAIAssistant?: () => void;
  exit?: () => void;
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
  type: 'melker' | 'md';
  convertedContent?: string;  // For .md files: the converted .melker content
  policy?: MelkerPolicy;      // Policy if present
  appDir?: string;            // App directory for resolving policy paths
  systemInfo?: SystemInfo;    // System info if available
  helpContent?: string;       // Help text content (markdown)
}

export class DevToolsManager {
  private _overlay?: Element;
  private _state?: DevToolsState;
  private _deps: DevToolsDependencies;

  constructor(deps: DevToolsDependencies) {
    this._deps = deps;
  }

  /**
   * Set the source content to display
   */
  setSource(content: string, filePath: string, type: 'melker' | 'md', convertedContent?: string, policy?: MelkerPolicy, appDir?: string, systemInfo?: SystemInfo, helpContent?: string): void {
    this._state = { content, filePath, type, convertedContent, policy, appDir, systemInfo, helpContent };
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

    // Tab 0: Help (if present)
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

    // Tab 1: Source (Melker source or converted content for .md files)
    const sourceContent = this._state.type === 'md' && this._state.convertedContent
      ? this._state.convertedContent
      : this._state.content;
    tabs.push(melker`
      <tab id="dev-tools-tab-melker" title="Source">
        <container id="dev-tools-scroll-melker" scrollable=${true} focusable=${true} style=${scrollStyle}>
          <text id="dev-tools-melker-content" text=${sourceContent} />
        </container>
      </tab>
    `);

    // Tab 2: Policy (if present)
    if (this._state.policy) {
      let policyText = formatPolicy(this._state.policy);
      const appDir = this._state.appDir || '.';
      const denoFlags = policyToDenoFlags(this._state.policy, appDir);
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

    // Tab 6: Actions
    tabs.push(melker`
      <tab id="dev-tools-tab-actions" title="Actions">
        <container id="dev-tools-actions-content" style=${{ flex: 1, padding: 1, width: 'fill', height: 'fill', display: 'flex', flexDirection: 'column', gap: 1 }}>
          <button id="dev-tools-action-perf" title="Performance Monitor" onClick=${onPerformance} />
          <button id="dev-tools-action-exit" title="Exit Application" onClick=${onExit} />
        </container>
      </tab>
    `);

    // Build the dialog with tabs
    const tabsStyle = { flex: 1, width: 'fill', height: 'fill' };
    const mainStyle = { display: 'flex', flexDirection: 'column', width: 'fill', height: 'fill' };
    const footerStyle = { display: 'flex', flexDirection: 'row', justifyContent: 'flex-end', width: 'fill', gap: 1 };

    this._overlay = melker`
      <dialog id="dev-tools-dialog" title=${`Dev Tools - ${filename}`} open=${true} modal=${true} backdrop=${true} width=${0.9} height=${0.85}>
        <container id="dev-tools-main" style=${mainStyle}>
          <tabs id="dev-tools-tabs" style=${tabsStyle}>
            ${tabs}
          </tabs>
          <container id="dev-tools-footer" style=${footerStyle}>
            <button id="dev-tools-ai" title="AI Assistant" onClick=${onAIAssistant} />
            <button id="dev-tools-close" title="Close" onClick=${onClose} />
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

    // Re-render
    if (this._deps.autoRender) {
      this._deps.render();
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
