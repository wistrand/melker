/**
 * Mermaid Class Diagram Parser
 *
 * Parses Mermaid class diagram syntax into ClassDiagramDefinition.
 * Supports a subset of Mermaid class diagram features.
 *
 * Supported syntax:
 * - Direction: direction TB|BT|LR|RL
 * - Class definitions: class ClassName, class ClassName { members }
 * - Members: +public, -private, #protected, ~package
 * - Methods: name(), name(params), name() returnType
 * - Classifiers: * (abstract), $ (static)
 * - Annotations: <<interface>>, <<abstract>>, <<service>>, <<enumeration>>
 * - Relationships: <|--, *--, o--, -->, ..>, ..|>, --, ..
 * - Cardinality: "1" --> "0..*"
 * - Generic types: List~String~
 */

import type {
  ClassDiagramDefinition,
  ClassNode,
  ClassMember,
  ClassRelation,
  ClassRelationType,
  ClassMemberVisibility,
  ClassMemberClassifier,
  ClassAnnotation,
  GraphDirection,
} from '../types.ts';
import type { ClassDiagramParser } from './types.ts';
import { GraphParseError } from './types.ts';

/** Relationship arrow patterns and their types */
const RELATIONSHIP_PATTERNS: Array<{ pattern: RegExp; type: ClassRelationType }> = [
  { pattern: /<\|--/, type: 'inheritance' },
  { pattern: /--\|>/, type: 'inheritance' },
  { pattern: /\*--/, type: 'composition' },
  { pattern: /--\*/, type: 'composition' },
  { pattern: /o--/, type: 'aggregation' },
  { pattern: /--o/, type: 'aggregation' },
  { pattern: /-->/, type: 'association' },
  { pattern: /<--/, type: 'association' },
  { pattern: /\.\.>/, type: 'dependency' },
  { pattern: /<\.\./, type: 'dependency' },
  { pattern: /\.\|\>/, type: 'realization' },
  { pattern: /<\|\.\./, type: 'realization' },
  { pattern: /--/, type: 'link' },
  { pattern: /\.\./, type: 'linkDashed' },
];

/**
 * Check if content is a class diagram
 */
export function isClassDiagram(content: string): boolean {
  const firstLines = content.split('\n').slice(0, 5).join('\n').toLowerCase();
  return firstLines.includes('classdiagram');
}

/**
 * Mermaid class diagram parser
 */
export class ClassDiagramParserImpl implements ClassDiagramParser {
  parse(input: string): ClassDiagramDefinition {
    const lines = input.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('%%'));

    if (lines.length === 0) {
      throw new GraphParseError('Empty input');
    }

    // Verify this is a class diagram
    const firstLine = lines[0].toLowerCase();
    if (!firstLine.startsWith('classdiagram')) {
      throw new GraphParseError('Not a class diagram (expected "classDiagram")');
    }

    const classes = new Map<string, ClassNode>();
    const relations: ClassRelation[] = [];
    let direction: GraphDirection | undefined;

    // Track if we're inside a class body
    let currentClassId: string | null = null;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];

      // Parse direction
      const dirMatch = line.match(/^direction\s+(TB|BT|LR|RL)$/i);
      if (dirMatch) {
        direction = dirMatch[1].toUpperCase() as GraphDirection;
        continue;
      }

      // Parse class body end
      if (line === '}') {
        currentClassId = null;
        continue;
      }

      // Parse class definition with body start: class ClassName { or class ClassName <<annotation>> {
      const classBodyMatch = line.match(/^class\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:<<([a-zA-Z]+)>>\s*)?\{$/);
      if (classBodyMatch) {
        const classId = classBodyMatch[1];
        const annotation = classBodyMatch[2]?.toLowerCase() as ClassAnnotation | undefined;
        if (!classes.has(classId)) {
          classes.set(classId, { id: classId, members: [], annotation });
        } else if (annotation) {
          classes.get(classId)!.annotation = annotation;
        }
        currentClassId = classId;
        continue;
      }

      // Parse class definition with annotation: class ClassName:::annotation or class ClassName <<annotation>>
      const classAnnotationMatch = line.match(/^class\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:::([a-zA-Z]+)|(?:\s+<<([a-zA-Z]+)>>))?$/);
      if (classAnnotationMatch) {
        const classId = classAnnotationMatch[1];
        const annotation = (classAnnotationMatch[2] || classAnnotationMatch[3])?.toLowerCase() as ClassAnnotation | undefined;
        if (!classes.has(classId)) {
          classes.set(classId, { id: classId, members: [], annotation });
        } else if (annotation) {
          classes.get(classId)!.annotation = annotation;
        }
        continue;
      }

      // Parse annotation line: <<interface>> ClassName
      const annotationLineMatch = line.match(/^<<([a-zA-Z]+)>>\s+([a-zA-Z_][a-zA-Z0-9_]*)$/);
      if (annotationLineMatch) {
        const annotation = annotationLineMatch[1].toLowerCase() as ClassAnnotation;
        const classId = annotationLineMatch[2];
        if (!classes.has(classId)) {
          classes.set(classId, { id: classId, members: [], annotation });
        } else {
          classes.get(classId)!.annotation = annotation;
        }
        continue;
      }

      // If inside class body, parse annotation or member
      if (currentClassId) {
        // Check for annotation inside body: <<interface>>
        const bodyAnnotationMatch = line.match(/^<<([a-zA-Z]+)>>$/);
        if (bodyAnnotationMatch) {
          const annotation = bodyAnnotationMatch[1].toLowerCase() as ClassAnnotation;
          classes.get(currentClassId)!.annotation = annotation;
          continue;
        }

        const member = this._parseMember(line);
        if (member) {
          classes.get(currentClassId)!.members.push(member);
        }
        continue;
      }

      // Parse member with colon notation: ClassName : +memberName
      const memberMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.+)$/);
      if (memberMatch) {
        const classId = memberMatch[1];
        const memberStr = memberMatch[2].trim();
        if (!classes.has(classId)) {
          classes.set(classId, { id: classId, members: [] });
        }
        const member = this._parseMember(memberStr);
        if (member) {
          classes.get(classId)!.members.push(member);
        }
        continue;
      }

      // Parse relationship
      const relation = this._parseRelation(line, classes);
      if (relation) {
        relations.push(relation);
        continue;
      }
    }

    return {
      diagramType: 'class',
      direction,
      classes: Array.from(classes.values()),
      relations,
    };
  }

  /**
   * Parse a class member from a string
   */
  private _parseMember(str: string): ClassMember | null {
    let s = str.trim();
    if (!s) return null;

    // Parse visibility prefix
    let visibility: ClassMemberVisibility | undefined;
    if (s.startsWith('+')) {
      visibility = 'public';
      s = s.substring(1).trim();
    } else if (s.startsWith('-')) {
      visibility = 'private';
      s = s.substring(1).trim();
    } else if (s.startsWith('#')) {
      visibility = 'protected';
      s = s.substring(1).trim();
    } else if (s.startsWith('~')) {
      visibility = 'package';
      s = s.substring(1).trim();
    }

    // Parse classifier suffix
    let classifier: ClassMemberClassifier | undefined;
    if (s.endsWith('*')) {
      classifier = 'abstract';
      s = s.substring(0, s.length - 1).trim();
    } else if (s.endsWith('$')) {
      classifier = 'static';
      s = s.substring(0, s.length - 1).trim();
    }

    // Check if it's a method (has parentheses)
    // Format: name(params) or name(params): returnType
    const methodMatch = s.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^)]*)\)\s*(?::\s*(.+))?$/);
    if (methodMatch) {
      return {
        name: methodMatch[1],
        parameters: methodMatch[2] || undefined,
        type: methodMatch[3]?.trim(),
        visibility,
        classifier,
        isMethod: true,
      };
    }

    // Parse as attribute: name: type format
    const attrColonMatch = s.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.+)$/);
    if (attrColonMatch) {
      return {
        name: attrColonMatch[1],
        type: attrColonMatch[2].trim(),
        visibility,
        classifier,
        isMethod: false,
      };
    }

    // Parse as attribute: Type name format (Mermaid style)
    // Allow array notation [] in type, e.g., Element[] children
    const attrTypeNameMatch = s.match(/^([a-zA-Z_][a-zA-Z0-9_<>~\[\]]*)\s+([a-zA-Z_][a-zA-Z0-9_]*)$/);
    if (attrTypeNameMatch) {
      // Convert generic notation: List~String~ to List<String>
      let type = attrTypeNameMatch[1].replace(/~([^~]+)~/g, '<$1>');
      return {
        name: attrTypeNameMatch[2],
        type,
        visibility,
        classifier,
        isMethod: false,
      };
    }

    // Handle generic types: List~String~ (standalone)
    const genericMatch = s.match(/^([a-zA-Z_][a-zA-Z0-9_]*)~([^~]+)~$/);
    if (genericMatch) {
      return {
        name: genericMatch[1],
        type: genericMatch[2],
        visibility,
        classifier,
        isMethod: false,
      };
    }

    // Plain name (no type)
    const plainMatch = s.match(/^([a-zA-Z_][a-zA-Z0-9_]*)$/);
    if (plainMatch) {
      return {
        name: plainMatch[1],
        visibility,
        classifier,
        isMethod: false,
      };
    }

    return null;
  }

  /**
   * Parse a relationship line
   */
  private _parseRelation(line: string, classes: Map<string, ClassNode>): ClassRelation | null {
    // Try to find a relationship arrow
    for (const { pattern, type } of RELATIONSHIP_PATTERNS) {
      const match = line.match(pattern);
      if (match) {
        // Split line by the arrow
        const parts = line.split(pattern);
        if (parts.length >= 2) {
          const leftPart = parts[0].trim();
          const rightPart = parts.slice(1).join('').trim();

          // Parse left side: "cardinality" ClassName or just ClassName
          const { classId: fromId, cardinality: fromCard } = this._parseRelationSide(leftPart);
          // Parse right side: ClassName "cardinality" : label or ClassName : label
          const { classId: toId, cardinality: toCard, label } = this._parseRelationSide(rightPart, true);

          if (fromId && toId) {
            // Ensure both classes exist
            if (!classes.has(fromId)) {
              classes.set(fromId, { id: fromId, members: [] });
            }
            if (!classes.has(toId)) {
              classes.set(toId, { id: toId, members: [] });
            }

            return {
              from: fromId,
              to: toId,
              type,
              label,
              fromCardinality: fromCard,
              toCardinality: toCard,
            };
          }
        }
      }
    }

    return null;
  }

  /**
   * Parse one side of a relationship
   */
  private _parseRelationSide(
    str: string,
    parseLabel: boolean = false
  ): { classId: string | null; cardinality?: string; label?: string } {
    let s = str.trim();
    let label: string | undefined;
    let cardinality: string | undefined;

    // Parse label (at the end after :)
    if (parseLabel) {
      const labelMatch = s.match(/^(.+?)\s*:\s*(.+)$/);
      if (labelMatch) {
        s = labelMatch[1].trim();
        label = labelMatch[2].trim();
      }
    }

    // Parse cardinality in quotes
    const cardBeforeMatch = s.match(/^"([^"]+)"\s+(.+)$/);
    if (cardBeforeMatch) {
      cardinality = cardBeforeMatch[1];
      s = cardBeforeMatch[2].trim();
    }

    const cardAfterMatch = s.match(/^(.+?)\s+"([^"]+)"$/);
    if (cardAfterMatch) {
      s = cardAfterMatch[1].trim();
      if (!cardinality) {
        cardinality = cardAfterMatch[2];
      }
    }

    // What remains should be the class ID
    const classMatch = s.match(/^([a-zA-Z_][a-zA-Z0-9_]*)$/);
    if (classMatch) {
      return { classId: classMatch[1], cardinality, label };
    }

    return { classId: null, cardinality, label };
  }
}
