// Autocomplete component - Combobox with async data loading
import {
  Element,
  Bounds,
  ComponentRenderContext,
} from '../../types.ts';
import type { DualBuffer, Cell } from '../../buffer.ts';
import { getThemeColor } from '../../theme.ts';
import { registerComponent } from '../../element.ts';
import { registerComponentSchema, type ComponentSchema } from '../../lint.ts';
import { ComboboxElement, ComboboxProps } from './combobox.ts';
import { OptionData } from './core.ts';
import { getLogger } from '../../logging.ts';

const logger = getLogger('autocomplete');

/**
 * Event fired when search is triggered
 */
export interface SearchEvent {
  type: 'search';
  /** Current search query */
  query: string;
  /** Target element ID */
  targetId: string;
}

export interface AutocompleteProps extends ComboboxProps {
  /** Called when search should be performed (debounced). Return options array to update results. */
  onSearch?: (event: SearchEvent) => void | OptionData[] | Promise<void> | Promise<OptionData[]>;
  /** Whether data is currently loading */
  loading?: boolean;
  /** Debounce delay in ms (default: 300) */
  debounce?: number;
  /** Minimum characters before triggering search (default: 1) */
  minChars?: number;
  /** Dynamic options from search results */
  options?: OptionData[];
  /** Text to show when loading */
  loadingText?: string;
  /** Text to show when no results */
  noResultsText?: string;
}

/**
 * AutocompleteElement - Combobox with async data loading support.
 *
 * Features:
 * - All combobox features (filtering, keyboard nav, etc.)
 * - Debounced onSearch callback for async data loading
 * - Loading indicator while fetching
 * - Minimum character threshold before searching
 * - Static children act as default/recent options
 * - Dynamic options via props
 *
 * Usage:
 * ```xml
 * <autocomplete
 *   placeholder="Search users..."
 *   onSearch="$app.searchUsers(event.query)"
 *   loading="${$app.isLoading}"
 *   options="${$app.searchResults}"
 *   minChars="2"
 *   debounce="300"
 * >
 *   <group label="Recent">
 *     <option value="recent1">Last searched user...</option>
 *   </group>
 * </autocomplete>
 * ```
 */
export class AutocompleteElement extends ComboboxElement {
  declare props: AutocompleteProps;

  /** Debounce timer ID */
  private _debounceTimer: number | null = null;
  /** Last search query sent */
  private _lastSearchQuery: string = '';
  /** Dynamic options from search */
  private _dynamicOptions: OptionData[] = [];
  /** Callback to request re-render after async operations */
  private _requestRender: (() => void) | null = null;

  constructor(props: AutocompleteProps = {}, children: Element[] = []) {
    const defaultProps: AutocompleteProps = {
      debounce: 300,
      minChars: 1,
      loadingText: 'Loading...',
      noResultsText: 'No results',
      filter: 'none', // Don't filter - server handles it
      ...props,
    };

    super(defaultProps, children);
    (this as any).type = 'autocomplete';
  }

  /**
   * Override to trigger search on input change
   */
  override handleKeyInput(key: string, ctrlKey: boolean = false, altKey: boolean = false): boolean {
    const handled = super.handleKeyInput(key, ctrlKey, altKey);

    if (handled) {
      // Input changed - trigger debounced search
      this._triggerSearch();
    }

    return handled;
  }

  /**
   * Trigger debounced search
   */
  private _triggerSearch(): void {
    const query = this.props.value || '';
    const minChars = this.props.minChars ?? 1;
    const debounceMs = this.props.debounce ?? 300;

    // Clear existing timer
    if (this._debounceTimer !== null) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }

    // Check minimum characters
    if (query.length < minChars) {
      // Clear dynamic options when below threshold
      this._dynamicOptions = [];
      this._lastSearchQuery = '';
      return;
    }

    // Skip if query hasn't changed
    if (query === this._lastSearchQuery) {
      return;
    }

    // Debounce the search
    this._debounceTimer = setTimeout(() => {
      this._debounceTimer = null;
      this._executeSearch(query);
    }, debounceMs) as unknown as number;
  }

  /**
   * Execute the actual search
   */
  private _executeSearch(query: string): void {
    if (!this.props.onSearch) return;

    this._lastSearchQuery = query;

    const event: SearchEvent = {
      type: 'search',
      query,
      targetId: this.id,
    };

    logger.debug(`Executing search: "${query}"`);

    // Set loading state
    this.props.loading = true;

    // Call the search handler (may be async and return options)
    try {
      const result = this.props.onSearch(event);

      // Handle async result
      if (result && typeof (result as Promise<OptionData[]>).then === 'function') {
        (result as Promise<OptionData[]>).then((options) => {
          if (options && Array.isArray(options)) {
            this.setOptions(options);
          }
          this.props.loading = false;
          // Request re-render after async operation
          if (this._requestRender) {
            this._requestRender();
          }
        }).catch((error: Error) => {
          logger.error('Search handler error:', error);
          this.props.loading = false;
          if (this._requestRender) {
            this._requestRender();
          }
        });
      } else if (result && Array.isArray(result)) {
        // Sync result
        this.setOptions(result as OptionData[]);
        this.props.loading = false;
      } else {
        // No result returned - handler manages options itself
        this.props.loading = false;
      }
    } catch (error) {
      logger.error('Search handler error:', error as Error);
      this.props.loading = false;
    }
  }

  /**
   * Set dynamic options (can be called from search handler)
   */
  setOptions(options: OptionData[]): void {
    this._dynamicOptions = options;
    this.invalidateFilterCache();
  }

  /**
   * Override getAllOptions to include dynamic options from search
   */
  override getAllOptions(): OptionData[] {
    // Get static options from children
    const staticOptions = super.getAllOptions();

    // Get dynamic options from internal state (props.options handled by parent)
    const dynamicOptions = this._dynamicOptions;

    // Merge: static first (defaults/recent), then dynamic
    return [...staticOptions, ...dynamicOptions];
  }

  /**
   * Override render to capture requestRender callback
   */
  override render(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer, context: ComponentRenderContext): void {
    // Capture requestRender for async operations
    if (context.requestRender) {
      this._requestRender = context.requestRender;
    }
    // Call parent render
    super.render(bounds, style, buffer, context);
  }

  /**
   * Override to render loading indicator in dropdown
   */
  protected override _renderDropdownContent(
    dropdownBounds: Bounds,
    style: Partial<Cell>,
    buffer: DualBuffer,
    context: ComponentRenderContext,
    isFocused: boolean
  ): void {
    // If loading, show loading indicator
    if (this.props.loading) {
      this._renderLoading(dropdownBounds, style, buffer);
      return;
    }

    // Check if we have results
    const filtered = this.getFilteredOptions();
    if (filtered.length === 0 && this._lastSearchQuery.length > 0) {
      this._renderNoResults(dropdownBounds, style, buffer);
      return;
    }

    // Normal dropdown content
    super._renderDropdownContent(dropdownBounds, style, buffer, context, isFocused);
  }

  /**
   * Render loading indicator
   */
  private _renderLoading(dropdownBounds: Bounds, style: Partial<Cell>, buffer: DualBuffer): void {
    const loadingStyle: Partial<Cell> = {
      ...style,
      background: getThemeColor('surface'),
      foreground: getThemeColor('textMuted'),
    };

    // Draw border
    this._drawDropdownBorder(dropdownBounds, loadingStyle, buffer);

    // Render loading text with spinner
    const text = this.props.loadingText || 'Loading...';
    const spinnerChars = ['|', '/', '-', '\\'];
    const spinnerIndex = Math.floor(Date.now() / 200) % spinnerChars.length;
    const displayText = `${spinnerChars[spinnerIndex]} ${text}`;

    const x = dropdownBounds.x + 1;
    const y = dropdownBounds.y + 1;
    buffer.currentBuffer.setText(x, y, displayText.substring(0, dropdownBounds.width - 2), loadingStyle);
  }

  /**
   * Render no results message
   */
  protected override _renderNoResults(inputBounds: Bounds, style: Partial<Cell>, buffer: DualBuffer): void {
    const dropdownBounds = this._calculateDropdownBounds(inputBounds);

    const noResultsStyle: Partial<Cell> = {
      ...style,
      background: getThemeColor('surface'),
      foreground: getThemeColor('textMuted'),
    };

    // Draw border
    this._drawDropdownBorder(dropdownBounds, noResultsStyle, buffer);

    // Render no results text
    const text = this.props.noResultsText || 'No results';
    const x = dropdownBounds.x + Math.floor((dropdownBounds.width - text.length) / 2);
    const y = dropdownBounds.y + 1;
    buffer.currentBuffer.setText(x, y, text, noResultsStyle);
  }

  /**
   * Calculate dropdown bounds (needed for no results rendering)
   */
  private _calculateDropdownBounds(inputBounds: Bounds): Bounds {
    const dropdownWidth = this.props.dropdownWidth || inputBounds.width;
    const dropdownHeight = 3; // Border + 1 line + border

    return {
      x: inputBounds.x,
      y: inputBounds.y + inputBounds.height,
      width: dropdownWidth,
      height: dropdownHeight,
    };
  }


  /**
   * Clean up on close
   */
  override close(): void {
    // Clear debounce timer
    if (this._debounceTimer !== null) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
    super.close();
  }
}

// Register the autocomplete component
registerComponent({
  type: 'autocomplete',
  componentClass: AutocompleteElement,
  defaultProps: {
    open: false,
    filter: 'none', // Server-side filtering
    maxVisible: 8,
    debounce: 300,
    minChars: 1,
    loadingText: 'Loading...',
    noResultsText: 'No results',
    disabled: false,
    tabIndex: 0,
  },
});

// Schema for lint validation
export const autocompleteSchema: ComponentSchema = {
  description: 'Input with async search and dropdown suggestions',
  props: {
    value: { type: 'string', description: 'Current input text' },
    selectedValue: { type: 'string', description: 'Currently selected option value' },
    placeholder: { type: 'string', description: 'Placeholder text when empty' },
    open: { type: 'boolean', description: 'Whether dropdown is open' },
    disabled: { type: 'boolean', description: 'Disable the component' },
    loading: { type: 'boolean', description: 'Show loading indicator' },
    debounce: { type: 'number', description: 'Debounce delay in ms (default: 300)' },
    minChars: { type: 'number', description: 'Minimum characters before search (default: 1)' },
    maxVisible: { type: 'number', description: 'Maximum visible options in dropdown' },
    dropdownWidth: { type: 'number', description: 'Override dropdown width' },
    loadingText: { type: 'string', description: 'Text shown while loading' },
    noResultsText: { type: 'string', description: 'Text shown when no results' },
    onSearch: { type: 'function', description: 'Called when search should be performed' },
    onSelect: { type: 'function', description: 'Called when option is selected' },
    onFilterChange: { type: 'function', description: 'Called when filter text changes' },
    onOpenChange: { type: 'function', description: 'Called when dropdown opens/closes' },
  },
};

registerComponentSchema('autocomplete', autocompleteSchema);
