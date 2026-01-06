// Filterable List Components - Module exports
//
// This module provides a unified primitive for searchable/selectable lists:
// - <option> - Selectable item
// - <group> - Groups options under a header
// - <combobox> - Inline dropdown with text filter
// - <select> - Dropdown without filter (picker only)
// - <autocomplete> - Combobox with async loading support
// - <command-palette> - Modal command picker

// Child elements
export { OptionElement, type OptionProps } from './option.ts';
export { GroupElement, type GroupProps } from './group.ts';

// Filter algorithms
export {
  fuzzyMatch,
  prefixMatch,
  containsMatch,
  exactMatch,
  applyFilter,
  filterOptions,
  type FuzzyMatchResult,
  type FilterMode,
  type FilteredOption,
} from './filter.ts';

// Core base class
export {
  FilterableListCore,
  type FilterableListCoreProps,
  type OptionData,
  type FilteredOptionData,
  type DropdownRow,
  type OptionSelectEvent,
  type FilterChangeEvent,
} from './core.ts';

// Components
export { ComboboxElement, type ComboboxProps } from './combobox.ts';
export { SelectElement, type SelectProps } from './select.ts';
export { AutocompleteElement, type AutocompleteProps, type SearchEvent } from './autocomplete.ts';
export { CommandPaletteElement, type CommandPaletteProps } from './command-palette.ts';
