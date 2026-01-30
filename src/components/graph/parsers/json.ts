/**
 * JSON Graph Parser
 *
 * Parses JSON input directly into GraphDefinition.
 * Validates the structure and provides defaults.
 */

import type { GraphDefinition, GraphNode, GraphEdge, GraphDirection, NodeShape } from '../types.ts';
import type { GraphParser } from './types.ts';
import { GraphParseError } from './types.ts';

/**
 * JSON parser for graph definitions
 */
export class JsonParser implements GraphParser {
  parse(input: string): GraphDefinition {
    let data: unknown;

    try {
      data = JSON.parse(input);
    } catch (e) {
      throw new GraphParseError(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
    }

    return this._validate(data);
  }

  private _validate(data: unknown): GraphDefinition {
    if (!data || typeof data !== 'object') {
      throw new GraphParseError('Graph definition must be an object');
    }

    const obj = data as Record<string, unknown>;

    // Validate direction
    const direction = this._validateDirection(obj.direction);

    // Validate nodes
    const nodes = this._validateNodes(obj.nodes);

    // Validate edges
    const edges = this._validateEdges(obj.edges, nodes);

    // Validate subgraphs (optional)
    const subgraphs = obj.subgraphs ? this._validateSubgraphs(obj.subgraphs, nodes) : undefined;

    return {
      direction,
      nodes,
      edges,
      ...(subgraphs && { subgraphs }),
    };
  }

  private _validateDirection(value: unknown): GraphDirection {
    const validDirections: GraphDirection[] = ['TB', 'LR', 'BT', 'RL'];

    if (value === undefined) {
      return 'TB'; // Default direction
    }

    if (typeof value !== 'string' || !validDirections.includes(value as GraphDirection)) {
      throw new GraphParseError(`Invalid direction: ${value}. Must be one of: ${validDirections.join(', ')}`);
    }

    return value as GraphDirection;
  }

  private _validateNodes(value: unknown): GraphNode[] {
    if (!Array.isArray(value)) {
      throw new GraphParseError('nodes must be an array');
    }

    return value.map((node, index) => this._validateNode(node, index));
  }

  private _validateNode(value: unknown, index: number): GraphNode {
    if (!value || typeof value !== 'object') {
      throw new GraphParseError(`Node at index ${index} must be an object`);
    }

    const obj = value as Record<string, unknown>;

    if (typeof obj.id !== 'string' || !obj.id) {
      throw new GraphParseError(`Node at index ${index} must have a string id`);
    }

    const validShapes: NodeShape[] = ['rect', 'rounded', 'diamond', 'circle', 'ellipse', 'hexagon', 'parallelogram'];
    const shape = obj.shape ?? 'rect';

    if (typeof shape !== 'string' || !validShapes.includes(shape as NodeShape)) {
      throw new GraphParseError(`Node "${obj.id}" has invalid shape: ${shape}`);
    }

    const node: GraphNode = {
      id: obj.id,
      label: typeof obj.label === 'string' ? obj.label : obj.id,
      shape: shape as NodeShape,
    };

    if (obj.style) {
      node.style = obj.style as GraphNode['style'];
    }

    // Support custom melker element content
    if (typeof obj.element === 'string') {
      node.element = obj.element;
    }

    return node;
  }

  private _validateEdges(value: unknown, nodes: GraphNode[]): GraphEdge[] {
    if (!Array.isArray(value)) {
      throw new GraphParseError('edges must be an array');
    }

    const nodeIds = new Set(nodes.map(n => n.id));

    return value.map((edge, index) => this._validateEdge(edge, index, nodeIds));
  }

  private _validateEdge(value: unknown, index: number, nodeIds: Set<string>): GraphEdge {
    if (!value || typeof value !== 'object') {
      throw new GraphParseError(`Edge at index ${index} must be an object`);
    }

    const obj = value as Record<string, unknown>;

    if (typeof obj.from !== 'string' || !obj.from) {
      throw new GraphParseError(`Edge at index ${index} must have a string 'from' property`);
    }

    if (typeof obj.to !== 'string' || !obj.to) {
      throw new GraphParseError(`Edge at index ${index} must have a string 'to' property`);
    }

    if (!nodeIds.has(obj.from)) {
      throw new GraphParseError(`Edge references unknown node: ${obj.from}`);
    }

    if (!nodeIds.has(obj.to)) {
      throw new GraphParseError(`Edge references unknown node: ${obj.to}`);
    }

    const edge: GraphEdge = {
      from: obj.from,
      to: obj.to,
    };

    if (typeof obj.label === 'string') {
      edge.label = obj.label;
    }
    if (obj.arrowStart) {
      edge.arrowStart = obj.arrowStart as GraphEdge['arrowStart'];
    }
    if (obj.arrowEnd) {
      edge.arrowEnd = obj.arrowEnd as GraphEdge['arrowEnd'];
    }
    if (obj.style) {
      edge.style = obj.style as GraphEdge['style'];
    }

    return edge;
  }

  private _validateSubgraphs(value: unknown, nodes: GraphNode[]): GraphDefinition['subgraphs'] {
    if (!Array.isArray(value)) {
      throw new GraphParseError('subgraphs must be an array');
    }

    const nodeIds = new Set(nodes.map(n => n.id));

    return value.map((subgraph, index) => {
      if (!subgraph || typeof subgraph !== 'object') {
        throw new GraphParseError(`Subgraph at index ${index} must be an object`);
      }

      const obj = subgraph as Record<string, unknown>;

      if (typeof obj.id !== 'string' || !obj.id) {
        throw new GraphParseError(`Subgraph at index ${index} must have a string id`);
      }

      if (!Array.isArray(obj.nodes)) {
        throw new GraphParseError(`Subgraph "${obj.id}" must have a nodes array`);
      }

      for (const nodeId of obj.nodes) {
        if (typeof nodeId !== 'string' || !nodeIds.has(nodeId)) {
          throw new GraphParseError(`Subgraph "${obj.id}" references unknown node: ${nodeId}`);
        }
      }

      const subgraphDef: { id: string; label?: string; nodes: string[]; style?: GraphNode['style'] } = {
        id: obj.id,
        nodes: obj.nodes as string[],
      };

      if (typeof obj.label === 'string') {
        subgraphDef.label = obj.label;
      }
      if (obj.style) {
        subgraphDef.style = obj.style as GraphNode['style'];
      }

      return subgraphDef;
    });
  }
}
