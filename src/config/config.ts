// Full configuration class for Melker framework consumers.
// Extends MelkerConfigCore with ~53 typed getters for AI, audio,
// dithering, rendering, OAuth, stdout, toast, etc.

import { MelkerConfigCore } from './config-core.ts';
import type { GfxMode } from '../core-types.ts';

// Re-export everything from core
export * from './config-core.ts';

export class MelkerConfig extends MelkerConfigCore {
  // Narrow return type for framework consumers
  static override get(): MelkerConfig {
    return super.get() as MelkerConfig;
  }

  // ============================================================================
  // Typed getters - defaults come from schema.json via resolveValue()
  // ============================================================================

  // Logging (logFile is in core)
  get logLevel(): string {
    return this.data['log.level'] as string;
  }

  // AI
  get aiModel(): string {
    return this.data['ai.model'] as string;
  }

  get aiAudioModel(): string {
    return this.data['ai.audioModel'] as string;
  }

  get aiEndpoint(): string {
    return this.data['ai.endpoint'] as string;
  }

  get aiHeaders(): Record<string, string> | undefined {
    return this.data['ai.headers'] as Record<string, string> | undefined;
  }

  get aiSiteName(): string | undefined {
    return this.data['ai.siteName'] as string | undefined;
  }

  get aiSiteUrl(): string | undefined {
    return this.data['ai.siteUrl'] as string | undefined;
  }

  get aiAudioGain(): number {
    return this.data['ai.audioGain'] as number;
  }

  // Audio
  get audioMuted(): boolean {
    return this.data['audio.muted'] as boolean;
  }

  // Dithering
  get ditherAlgorithm(): string | undefined {
    return this.data['dither.algorithm'] as string | undefined;
  }

  get ditherBits(): number | undefined {
    return this.data['dither.bits'] as number | undefined;
  }

  get blueNoisePath(): string | undefined {
    return this.data['dither.blueNoisePath'] as string | undefined;
  }

  // Terminal
  get terminalAlternateScreen(): boolean {
    return this.data['terminal.alternateScreen'] as boolean;
  }

  get terminalSyncRendering(): boolean {
    return this.data['terminal.syncRendering'] as boolean;
  }

  get terminalForceFFmpeg(): boolean {
    return this.data['terminal.forceFFmpeg'] as boolean;
  }

  // Render
  get animateGif(): boolean {
    return this.data['render.animateGif'] as boolean;
  }

  get gfxMode(): GfxMode | undefined {
    // Only return gfxMode if explicitly set (env, cli, file, policy) - not schema default
    // This allows per-element gfxMode props to take effect when no global override
    if (this.sources['render.gfxMode'] === 'default') {
      return undefined;
    }
    return this.data['render.gfxMode'] as GfxMode;
  }

  // Isolines
  get isolineCount(): number {
    return this.data['render.isolineCount'] as number;
  }

  get isolineMode(): 'equal' | 'quantile' | 'nice' {
    return this.data['render.isolineMode'] as 'equal' | 'quantile' | 'nice';
  }

  get isolineSource(): 'luma' | 'red' | 'green' | 'blue' | 'alpha' | 'oklab' | 'oklch-hue' {
    return this.data['render.isolineSource'] as 'luma' | 'red' | 'green' | 'blue' | 'alpha' | 'oklab' | 'oklch-hue';
  }

  get isolineFill(): 'source' | 'color' | 'color-mean' {
    return this.data['render.isolineFill'] as 'source' | 'color' | 'color-mean';
  }

  get isolineColor(): string {
    return this.data['render.isolineColor'] as string;
  }

  // Headless (headlessEnabled is in core)
  get headlessWidth(): number {
    return this.data['headless.width'] as number;
  }

  get headlessHeight(): number {
    return this.data['headless.height'] as number;
  }

  // Server (serverEnabled and serverPort are in core)
  get serverHost(): string {
    return this.data['server.host'] as string;
  }

  get serverToken(): string | undefined {
    return this.data['server.token'] as string | undefined;
  }

  get serverAllowInput(): boolean {
    return this.data['server.allowInput'] as boolean;
  }

  // Assets
  get dynamicAssets(): boolean {
    return this.data['assets.dynamic'] as boolean;
  }

  // Bundler
  get bundlerRetainBundle(): boolean {
    return this.data['bundler.retainBundle'] as boolean;
  }

  // Performance
  get performanceShowStats(): boolean {
    return this.data['performance.showStats'] as boolean;
  }

  // Markdown
  get markdownDebug(): boolean {
    return this.data['markdown.debug'] as boolean;
  }

  // Audio
  get audioDebug(): boolean {
    return this.data['audio.debug'] as boolean;
  }

  // Persistence
  get persist(): boolean {
    return this.data['persist'] as boolean;
  }

  // Lint
  get lint(): boolean {
    return this.data['lint'] as boolean;
  }

  // Script
  get consoleOverride(): boolean {
    return this.data['script.consoleOverride'] as boolean;
  }

  // OAuth
  get oauthClientId(): string {
    return this.data['oauth.clientId'] as string;
  }

  get oauthPort(): number {
    return this.data['oauth.port'] as number;
  }

  get oauthPath(): string {
    return this.data['oauth.path'] as string;
  }

  get oauthRedirectUri(): string | undefined {
    return this.data['oauth.redirectUri'] as string | undefined;
  }

  get oauthScopes(): string {
    return this.data['oauth.scopes'] as string;
  }

  get oauthAudience(): string | undefined {
    return this.data['oauth.audience'] as string | undefined;
  }

  get oauthWellknownUrl(): string | undefined {
    return this.data['oauth.wellknownUrl'] as string | undefined;
  }

  // Stdout mode
  get stdoutEnabled(): boolean {
    return this.data['stdout.enabled'] as boolean;
  }

  get stdoutTimeout(): number {
    return this.data['stdout.timeout'] as number;
  }

  get stdoutWidth(): number | undefined {
    return this.data['stdout.width'] as number | undefined;
  }

  get stdoutHeight(): number | undefined {
    return this.data['stdout.height'] as number | undefined;
  }

  get stdoutColor(): 'auto' | 'always' | 'never' {
    return (this.data['stdout.color'] as 'auto' | 'always' | 'never') ?? 'auto';
  }

  get stdoutTrim(): 'none' | 'right' | 'bottom' | 'both' {
    return (this.data['stdout.trim'] as 'none' | 'right' | 'bottom' | 'both') ?? 'none';
  }

  // Toast
  get toastMaxVisible(): number {
    return (this.data['toast.maxVisible'] as number) ?? 5;
  }

  get toastPosition(): 'bottom' | 'top' {
    return (this.data['toast.position'] as 'bottom' | 'top') ?? 'bottom';
  }

  get toastDefaultDuration(): number {
    return (this.data['toast.defaultDuration'] as number) ?? 5000;
  }

  get toastInactivityTimeout(): number {
    return (this.data['toast.inactivityTimeout'] as number) ?? 8000;
  }

  get toastBell(): boolean {
    return (this.data['toast.bell'] as boolean) ?? false;
  }

  get toastWidth(): number {
    return (this.data['toast.width'] as number) ?? 40;
  }
}
