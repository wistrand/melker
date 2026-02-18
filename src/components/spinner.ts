// Spinner component - animated loading indicator

import { Element, BaseProps, Renderable, Bounds, ComponentRenderContext, IntrinsicSizeContext } from '../types.ts';
import type { DualBuffer, Cell } from '../buffer.ts';
import { getUIAnimationManager } from '../ui-animation-manager.ts';
import { getUnicodeTier } from '../utils/terminal-detection.ts';

/** Spinner animation variants */
export type SpinnerVariant = 'none' | 'line' | 'dots' | 'braille' | 'arc' | 'bounce' | 'flower' | 'pulse';

/** Predefined verb theme names */
export type VerbTheme =
  | 'loading' | 'thinking' | 'working' | 'waiting' | 'fetching' | 'saving'
  | 'dreaming' | 'conjuring' | 'brewing' | 'weaving' | 'unfolding' | 'stargazing';

/** Animation frame sequences for each variant */
const SPINNER_FRAMES: Record<SpinnerVariant, string[]> = {
  none:    [],
  line:    ['|', '/', '-', '\\'],
  dots:    ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  braille: ['⣷', '⣯', '⣟', '⡿', '⢿', '⣻', '⣽', '⣾'],
  arc:     ['◜', '◠', '◝', '◞', '◡', '◟'],
  bounce:  ['⠁', '⠂', '⠄', '⠂'],
  flower:  ['·', '✻', '✽', '✶', '✳', '✢'],
  pulse:   ['·', '•', '●', '•'],
};

/** Predefined verb themes */
const VERB_THEMES: Record<VerbTheme, string[]> = {
  // Standard themes
  loading:  ['Loading', 'Loading.', 'Loading..', 'Loading...'],
  thinking: ['Thinking', 'Pondering', 'Contemplating', 'Reasoning'],
  working:  ['Working', 'Processing', 'Computing', 'Calculating'],
  waiting:  ['Please wait', 'Hold on', 'One moment', 'Almost there'],
  fetching: ['Fetching', 'Downloading', 'Retrieving', 'Receiving'],
  saving:   ['Saving', 'Writing', 'Storing', 'Committing'],
  // Poetic themes
  dreaming:   ['Dreaming', 'Drifting', 'Wandering', 'Imagining', 'Musing', 'Floating', 'Reverie', 'Daydreaming'],
  conjuring:  ['Conjuring', 'Summoning', 'Manifesting', 'Invoking', 'Channeling', 'Enchanting', 'Spellcasting', 'Incanting'],
  brewing:    ['Brewing', 'Simmering', 'Steeping', 'Distilling', 'Fermenting', 'Infusing', 'Concocting', 'Alchemizing'],
  weaving:    ['Weaving', 'Spinning', 'Threading', 'Stitching', 'Knitting', 'Braiding', 'Intertwining', 'Entwining'],
  unfolding:  ['Unfolding', 'Blossoming', 'Awakening', 'Emerging', 'Blooming', 'Unfurling', 'Revealing', 'Flourishing'],
  stargazing: ['Stargazing', 'Moonwatching', 'Skydreaming', 'Cloudreading', 'Stardrifting', 'Constellation', 'Celestial', 'Cosmic'],
};

// Variants that need full Unicode (braille, geometric shapes, dingbats)
const FULL_ONLY_VARIANTS: ReadonlySet<SpinnerVariant> = new Set([
  'dots', 'braille', 'arc', 'bounce', 'flower', 'pulse',
]);

/** Resolve variant for the current Unicode tier — non-full tiers fall back to 'line' */
function resolveVariant(variant: SpinnerVariant): SpinnerVariant {
  if (variant === 'none' || variant === 'line') return variant;
  if (getUnicodeTier() !== 'full' && FULL_ONLY_VARIANTS.has(variant)) return 'line';
  return variant;
}

/** Base animation tick interval for spinners (in ms) */
const SPINNER_TICK_INTERVAL = 50;

export interface SpinnerProps extends BaseProps {
  /** Text displayed beside the spinner (ignored if verbs is set) */
  text?: string;
  /** Animation style (default: 'line') */
  variant?: SpinnerVariant;
  /** Frame interval in milliseconds (default: 100) */
  speed?: number;
  /** Spinner position relative to text (default: 'left') */
  textPosition?: 'left' | 'right';
  /** Whether spinner is animating (default: true) */
  spinning?: boolean;
  /** Cycling text: theme name, comma-separated strings, or string array */
  verbs?: VerbTheme | string | string[];
  /** Verb cycle interval in milliseconds (default: 800) */
  verbSpeed?: number;
  /** Enable animated shade wave across text (default: false) */
  shade?: boolean;
  /** Shade wave speed in milliseconds per character (default: 60) */
  shadeSpeed?: number;
}

export class SpinnerElement extends Element implements Renderable {
  declare type: 'spinner';
  declare props: SpinnerProps;

  // Animation state - time-based instead of frame counters
  private _startTime: number = 0;
  private _animationId: string | null = null;
  private _unregisterFn: (() => void) | null = null;

  constructor(props: SpinnerProps, children: Element[] = []) {
    const defaultProps: SpinnerProps = {
      variant: 'line',
      speed: 100,
      textPosition: 'left',
      spinning: true,
      verbSpeed: 800,
      disabled: false,
      ...props,
      style: {
        ...props.style,
      },
    };

    super('spinner', defaultProps, children);
  }

  /**
   * Register with UI animation manager
   */
  private _register(): void {
    if (this._animationId) return;
    this._startTime = Date.now();
    this._animationId = `spinner-${this.id}-${Date.now()}`;
    const manager = getUIAnimationManager();
    this._unregisterFn = manager.register(this._animationId, () => {
      manager.requestRender();
    }, SPINNER_TICK_INTERVAL);
  }

  /**
   * Unregister from UI animation manager
   */
  private _unregister(): void {
    if (!this._animationId) return;
    if (this._unregisterFn) {
      this._unregisterFn();
      this._unregisterFn = null;
    }
    this._animationId = null;
  }

  /**
   * Cleanup when element is destroyed
   */
  destroy(): void {
    this._unregister();
  }

  /**
   * Get the current animation frame character based on elapsed time
   */
  private _getCurrentFrame(): string {
    const variant = resolveVariant(this.props.variant ?? 'line');
    const frames = SPINNER_FRAMES[variant];
    if (frames.length === 0) return ' ';
    const speed = this.props.speed ?? 100;
    const elapsed = Date.now() - this._startTime;
    const frameIndex = Math.floor(elapsed / speed) % frames.length;
    return frames[frameIndex];
  }

  /**
   * Get the verb list from theme name, custom array, or comma-separated string
   */
  private _getVerbs(): string[] | null {
    const { verbs } = this.props;
    if (!verbs) return null;
    if (Array.isArray(verbs)) return verbs;
    // Check if it's a theme name
    if (verbs in VERB_THEMES) return VERB_THEMES[verbs as VerbTheme];
    // Parse as comma-separated string
    return verbs.split(',').map(s => s.trim()).filter(s => s.length > 0);
  }

  /**
   * Get the current verb text based on elapsed time
   */
  private _getCurrentVerb(): string {
    const verbs = this._getVerbs();
    if (!verbs || verbs.length === 0) return this.props.text ?? '';
    const verbSpeed = this.props.verbSpeed ?? 800;
    const elapsed = Date.now() - this._startTime;
    const verbIndex = Math.floor(elapsed / verbSpeed) % verbs.length;
    return verbs[verbIndex];
  }

  /**
   * Render the spinner to the terminal buffer
   */
  render(
    bounds: Bounds,
    style: Partial<Cell>,
    buffer: DualBuffer,
    context: ComponentRenderContext
  ): void {
    const spinning = this.props.spinning ?? true;

    // Register/unregister with UI animation manager
    if (spinning && !this._animationId) {
      this._register();
    } else if (!spinning && this._animationId) {
      this._unregister();
    }

    if (bounds.width <= 0 || bounds.height <= 0) return;

    const variant = resolveVariant(this.props.variant ?? 'line');
    const text = this._getCurrentVerb();
    const textPosition = this.props.textPosition ?? 'left';
    const shade = this.props.shade ?? false;

    // Handle 'none' variant - text only, no spinner character
    if (variant === 'none') {
      if (text) {
        const displayText = text.slice(0, bounds.width);
        if (shade && spinning) {
          this._renderShadedText(buffer, bounds.x, bounds.y, displayText, style);
        } else {
          buffer.currentBuffer.setText(bounds.x, bounds.y, displayText, style);
        }
      }
      return;
    }

    // Get current frame (space if not spinning)
    const frame = spinning ? this._getCurrentFrame() : ' ';

    // Use setCell for spinner char to force single-cell width (avoids wide char issues)
    if (textPosition === 'left') {
      // Spinner first, then text
      buffer.currentBuffer.setCell(bounds.x, bounds.y, { char: frame, width: 1, ...style });
      if (text && bounds.width > 2) {
        const maxLen = bounds.width - 2;
        const displayText = text.slice(0, maxLen);
        if (shade && spinning) {
          this._renderShadedText(buffer, bounds.x + 2, bounds.y, displayText, style);
        } else {
          buffer.currentBuffer.setText(bounds.x + 2, bounds.y, displayText, style);
        }
      }
    } else {
      // Text first, then spinner
      if (text) {
        const maxTextLen = Math.max(0, bounds.width - 2);
        const displayText = text.slice(0, maxTextLen);
        if (shade && spinning) {
          this._renderShadedText(buffer, bounds.x, bounds.y, displayText, style);
        } else {
          buffer.currentBuffer.setText(bounds.x, bounds.y, displayText, style);
        }
        if (bounds.width > displayText.length + 1) {
          buffer.currentBuffer.setCell(bounds.x + displayText.length + 1, bounds.y, { char: frame, width: 1, ...style });
        }
      } else {
        buffer.currentBuffer.setCell(bounds.x, bounds.y, { char: frame, width: 1, ...style });
      }
    }
  }

  /**
   * Render text with animated shade wave effect.
   * Creates a spotlight that moves left to right with brightness gradient.
   */
  private _renderShadedText(
    buffer: DualBuffer,
    x: number,
    y: number,
    text: string,
    style: Partial<Cell>
  ): void {
    const shadeSpeed = this.props.shadeSpeed ?? 60;
    const elapsed = Date.now() - this._startTime;
    const textLen = text.length;

    // Peak position moves through text (wraps around)
    const peakPos = (elapsed / shadeSpeed) % textLen;

    // Get base foreground color (default to white if not set)
    const baseFg = style.foreground ?? 0xFFFFFFFF;
    const baseR = (baseFg >> 24) & 0xFF;
    const baseG = (baseFg >> 16) & 0xFF;
    const baseB = (baseFg >> 8) & 0xFF;
    const baseA = baseFg & 0xFF;

    for (let i = 0; i < textLen; i++) {
      const char = text[i];

      // Distance from peak (considering wrap-around)
      const dist = Math.min(
        Math.abs(i - peakPos),
        Math.abs(i - peakPos + textLen),
        Math.abs(i - peakPos - textLen)
      );

      // Brightness: 100% at peak, decreasing with distance
      // Pattern: 100%, 75%, 50%, 50%, 50%... (min 50%)
      const brightness = Math.max(0.5, 1.0 - dist * 0.25);

      // Darken the foreground color based on brightness
      const r = Math.round(baseR * brightness);
      const g = Math.round(baseG * brightness);
      const b = Math.round(baseB * brightness);
      const shadedFg = ((r << 24) | (g << 16) | (b << 8) | baseA) >>> 0;

      buffer.currentBuffer.setCell(x + i, y, {
        char,
        width: 1,
        ...style,
        foreground: shadedFg,
      });
    }
  }

  /**
   * Calculate intrinsic size for the spinner component
   */
  intrinsicSize(_context: IntrinsicSizeContext): { width: number; height: number } {
    const variant = resolveVariant(this.props.variant ?? 'line');
    const spinnerWidth = variant === 'none' ? 0 : 1;

    // Calculate text width - use longest verb if verbs are set
    const verbs = this._getVerbs();
    let textWidth: number;
    if (verbs && verbs.length > 0) {
      textWidth = Math.max(...verbs.map(v => v.length));
    } else {
      textWidth = (this.props.text ?? '').length;
    }

    const gap = (spinnerWidth > 0 && textWidth > 0) ? 1 : 0;

    return {
      width: spinnerWidth + gap + textWidth,
      height: 1,
    };
  }

  /**
   * Get the text content
   */
  getValue(): string {
    return this.props.text ?? '';
  }

  /**
   * Set the text content
   */
  setValue(text: string): void {
    this.props.text = text;
  }

  /**
   * Start the spinner animation
   */
  start(): void {
    this.props.spinning = true;
  }

  /**
   * Stop the spinner animation
   */
  stop(): void {
    this.props.spinning = false;
    this._unregister();
  }

  static validate(props: SpinnerProps): boolean {
    if (props.text !== undefined && typeof props.text !== 'string') {
      return false;
    }
    if (props.variant !== undefined && !['none', 'line', 'dots', 'braille', 'arc', 'bounce', 'flower', 'pulse'].includes(props.variant)) {
      return false;
    }
    if (props.speed !== undefined && (typeof props.speed !== 'number' || props.speed <= 0)) {
      return false;
    }
    if (props.textPosition !== undefined && !['left', 'right'].includes(props.textPosition)) {
      return false;
    }
    if (props.spinning !== undefined && typeof props.spinning !== 'boolean') {
      return false;
    }
    if (props.verbs !== undefined) {
      if (typeof props.verbs === 'string') {
        // Valid: theme name or comma-separated custom verbs
        // No validation needed - any string is valid
      } else if (!Array.isArray(props.verbs) || !props.verbs.every(v => typeof v === 'string')) {
        return false;
      }
    }
    if (props.verbSpeed !== undefined && (typeof props.verbSpeed !== 'number' || props.verbSpeed <= 0)) {
      return false;
    }
    if (props.shade !== undefined && typeof props.shade !== 'boolean') {
      return false;
    }
    if (props.shadeSpeed !== undefined && (typeof props.shadeSpeed !== 'number' || props.shadeSpeed <= 0)) {
      return false;
    }
    return true;
  }
}

// Lint schema for spinner component
import { registerComponentSchema, type ComponentSchema } from '../lint.ts';
import { registerComponent } from '../element.ts';

export const spinnerSchema: ComponentSchema = {
  description: 'Animated loading spinner with optional text or cycling verbs',
  props: {
    text:         { type: 'string', description: 'Text displayed beside spinner (ignored if verbs is set)' },
    variant:      { type: 'string', enum: ['none', 'line', 'dots', 'braille', 'arc', 'bounce', 'flower', 'pulse'], description: 'Animation style (default: line)' },
    speed:        { type: 'number', description: 'Frame interval in ms (default: 100)' },
    textPosition: { type: 'string', enum: ['left', 'right'], description: 'Spinner position relative to text (default: left)' },
    spinning:     { type: 'boolean', description: 'Whether spinner is animating (default: true)' },
    verbs:        { type: ['string', 'array'], description: 'Cycling text: theme name or comma-separated strings. Themes: loading, thinking, working, waiting, fetching, saving, dreaming, conjuring, brewing, weaving, unfolding, stargazing' },
    verbSpeed:    { type: 'number', description: 'Verb cycle interval in ms (default: 800)' },
    shade:        { type: 'boolean', description: 'Enable animated shade wave across text (default: false)' },
    shadeSpeed:   { type: 'number', description: 'Shade wave speed in ms per character (default: 60)' },
  },
};

registerComponentSchema('spinner', spinnerSchema);

// Register spinner component
registerComponent({
  type: 'spinner',
  componentClass: SpinnerElement,
  defaultProps: {
    variant: 'line',
    speed: 100,
    textPosition: 'left',
    spinning: true,
    verbSpeed: 800,
    disabled: false,
  },
  validate: (props) => SpinnerElement.validate(props as SpinnerProps),
});
