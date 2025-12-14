// ASCII box types for melker integration

export interface Box {
  id: string;
  /** Display name from `+--id Display Name--+` syntax */
  displayName?: string;
  isReference?: boolean;
  children?: Box[];
  bounds?: Bounds;
  properties?: Record<string, string>;
  /** Compact layout hints parsed from `: r 2 =` syntax */
  hints?: LayoutHints;
  /** Tab bar info parsed from `│ Tab1* │ Tab2 │` syntax */
  tabBar?: TabBarInfo;
  /** Inferred element type from shorthand syntax: [button], "text", {input}, <type> */
  inferredType?: string;
  /** Inferred properties from shorthand syntax */
  inferredProps?: Record<string, string>;
}

export interface BoxStructure {
  boxes: Map<string, Box>;
  rootBoxes: Box[];
}

export interface Bounds {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface ParsedBox {
  id: string;
  /** Display name from `+--id Display Name--+` syntax */
  displayName?: string;
  bounds: Bounds;
  isTopLevel: boolean;
  parentBounds?: Bounds;
  properties?: Record<string, string>;
  hints?: LayoutHints;
  /** Raw content lines for button detection */
  contentLines?: string[];
  /** Tab bar info parsed from `│ Tab1* │ Tab2 │` syntax */
  tabBar?: TabBarInfo;
  /** Inferred element type from shorthand syntax: [button], "text", {input}, <type> */
  inferredType?: string;
  /** Inferred properties from shorthand syntax */
  inferredProps?: Record<string, string>;
}

export interface LayoutHints {
  direction?: 'row' | 'column';
  gap?: number;
  justify?: 'start' | 'center' | 'end' | 'space-between';
  align?: 'start' | 'center' | 'end' | 'stretch';
  flex?: number;
  width?: number | 'fill';
  height?: number | 'fill';
}

export interface ParseError {
  message: string;
  line?: number;
  column?: number;
}

export interface ParseResult {
  structure?: BoxStructure;
  errors: ParseError[];
}

/** Button parsed from `[ #id @handler() Title ]` syntax */
export interface ParsedButton {
  id?: string;
  title: string;
  onClick?: string;
  bounds: { left: number; right: number; line: number };
}

/** Tab bar info parsed from `│ Tab1* │ Tab2 │` syntax */
export interface TabBarInfo {
  tabs: TabInfo[];
}

export interface TabInfo {
  title: string;
  isActive: boolean;
}
