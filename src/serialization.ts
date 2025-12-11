// JSON serialization and deserialization for elements

import { Element } from './types.ts';
import { createElement, isValidElementType } from './element.ts';

export interface SerializedElement {
  type: string;
  props: Record<string, any>;
  children?: SerializedElement[];
  id: string;
}

export function serializeElement(element: Element): SerializedElement {
  return {
    type: element.type,
    props: element.props,
    children: element.children?.map(child => serializeElement(child)),
    id: element.id,
  };
}

export function deserializeElement(serialized: SerializedElement): Element {
  if (!isValidElementType(serialized.type)) {
    throw new Error(`Invalid element type: ${serialized.type}`);
  }

  const children = serialized.children?.map(child => deserializeElement(child));
  const element = createElement(
    serialized.type,
    { ...serialized.props, id: serialized.id },
    ...(children || [])
  );

  return element;
}

export function elementToJson(element: Element): string {
  return JSON.stringify(serializeElement(element), null, 2);
}

export function elementFromJson(json: string): Element {
  try {
    const serialized = JSON.parse(json) as SerializedElement;
    return deserializeElement(serialized);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse element JSON: ${message}`);
  }
}

export function validateSerializedElement(obj: unknown): obj is SerializedElement {
  if (!obj || typeof obj !== 'object') {
    return false;
  }

  const element = obj as Record<string, unknown>;

  return (
    typeof element.type === 'string' &&
    isValidElementType(element.type) &&
    typeof element.props === 'object' &&
    element.props !== null &&
    (element.children === undefined || Array.isArray(element.children)) &&
    typeof element.id === 'string' &&
    (element.children === undefined || element.children.every(child => validateSerializedElement(child)))
  );
}