// Color provider (document colors and color presentations)

import type { Color, ColorInformation, ColorPresentation } from 'npm:vscode-languageserver@9.0.1/node.js';
import { parseHtml as parse } from '../deps.ts';
import { cssToRgba, unpackRGBA } from '../components/color-utils.ts';
import type { PackedRGBA } from '../types.ts';
import type { AstNode } from './types.ts';
import { createRange, parseStyleString } from './utils.ts';
import { stripCssComments, unwrapAtRules } from './css-utils.ts';
import { COLOR_PROPERTY_NAMES } from './constants.ts';

function packedToLspColor(packed: PackedRGBA): Color {
  const { r, g, b, a } = unpackRGBA(packed);
  return { red: r / 255, green: g / 255, blue: b / 255, alpha: a / 255 };
}

export function extractColors(text: string): ColorInformation[] {
  const colors: ColorInformation[] = [];

  try {
    const ast = parse(text) as AstNode[];

    function visitNode(node: AstNode): void {
      if (node.type !== 'Tag') {
        if (node.body) node.body.forEach(visitNode);
        return;
      }

      // Inline style attributes
      if (node.attributes) {
        for (const attr of node.attributes) {
          if (attr.name.value === 'style' && attr.value?.value) {
            const props = parseStyleString(attr.value.value, attr.value.start);
            for (const prop of props) {
              if (!COLOR_PROPERTY_NAMES.has(prop.name) || !prop.value) continue;
              if (prop.value.startsWith('var(')) continue;
              try {
                const packed = cssToRgba(prop.value);
                colors.push({
                  range: createRange(text, prop.valueStart, prop.valueEnd),
                  color: packedToLspColor(packed),
                });
              } catch { /* skip invalid */ }
            }
          }
        }
      }

      // Style tag CSS blocks
      if (node.name === 'style' && node.body) {
        for (const child of node.body) {
          if (child.type === 'Text' && child.value) {
            extractColorsFromCss(child.value, child.start, text, colors);
          }
        }
      }

      if (node.body) node.body.forEach(visitNode);
    }

    for (const node of ast) {
      visitNode(node);
    }
  } catch {
    // Ignore parse errors
  }

  return colors;
}

function extractColorsFromCss(
  css: string,
  contentStart: number,
  text: string,
  colors: ColorInformation[]
): void {
  const stripped = stripCssComments(css);
  const unwrapped = unwrapAtRules(stripped);

  const rulePattern = /([^{]+)\{([^}]*)\}/g;
  let match;
  while ((match = rulePattern.exec(unwrapped)) !== null) {
    const propertiesStr = match[2].trim();
    if (!propertiesStr) continue;

    const propsStart = contentStart + match.index + match[1].length + 1;
    const properties = propertiesStr.split(';');
    let propOffset = 0;

    for (const property of properties) {
      if (!property.trim()) {
        propOffset += property.length + 1;
        continue;
      }
      const colonIndex = property.indexOf(':');
      if (colonIndex === -1) {
        propOffset += property.length + 1;
        continue;
      }

      const keyPart = property.substring(0, colonIndex).trim();
      const valuePart = property.substring(colonIndex + 1).trim();
      const camelKey = keyPart.replace(/-([a-z])/g, (_m, letter: string) => letter.toUpperCase());

      if (COLOR_PROPERTY_NAMES.has(camelKey) && valuePart && !valuePart.startsWith('var(')) {
        try {
          const packed = cssToRgba(valuePart);
          const valueStartInProp = colonIndex + 1 + property.substring(colonIndex + 1).indexOf(valuePart);
          const absStart = propsStart + propOffset + valueStartInProp;
          colors.push({
            range: createRange(text, absStart, absStart + valuePart.length),
            color: packedToLspColor(packed),
          });
        } catch { /* skip invalid */ }
      }

      propOffset += property.length + 1;
    }
  }
}

export function getColorPresentations(color: Color): ColorPresentation[] {
  const r = Math.round(color.red * 255);
  const g = Math.round(color.green * 255);
  const b = Math.round(color.blue * 255);
  const a = color.alpha;

  const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  const presentations: ColorPresentation[] = [
    { label: hex },
    { label: `rgb(${r}, ${g}, ${b})` },
  ];

  if (a < 1) {
    presentations.push(
      { label: `${hex}${Math.round(a * 255).toString(16).padStart(2, '0')}` },
      { label: `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})` },
    );
  }

  return presentations;
}
