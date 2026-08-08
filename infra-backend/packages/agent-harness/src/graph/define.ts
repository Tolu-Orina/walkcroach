/**
 * defineGraph — validate and freeze a Graph definition before registration.
 */
import type { GraphDefinition, GraphState } from './types.js';

export class GraphDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GraphDefinitionError';
  }
}

export function defineGraph<S extends GraphState = GraphState>(
  def: GraphDefinition<S>,
): GraphDefinition<S> {
  if (!def.id?.trim()) throw new GraphDefinitionError('graph id is required');
  if (!def.entry?.trim()) throw new GraphDefinitionError('graph entry is required');
  if (!Number.isFinite(def.maxNodeExecutions) || def.maxNodeExecutions < 1) {
    throw new GraphDefinitionError('maxNodeExecutions must be >= 1');
  }
  if (!def.nodes?.length) {
    throw new GraphDefinitionError('graph must declare at least one node');
  }

  const ids = new Set<string>();
  for (const n of def.nodes) {
    if (!n.id?.trim()) throw new GraphDefinitionError('node id is required');
    if (ids.has(n.id)) {
      throw new GraphDefinitionError(`duplicate node id: ${n.id}`);
    }
    ids.add(n.id);
    if (!['code', 'agent', 'subagent', 'gate'].includes(n.kind)) {
      throw new GraphDefinitionError(`invalid node kind on ${n.id}: ${n.kind}`);
    }
    if (typeof n.run !== 'function') {
      throw new GraphDefinitionError(`node ${n.id} is missing run()`);
    }
  }

  if (!ids.has(def.entry)) {
    throw new GraphDefinitionError(`entry "${def.entry}" is not a declared node`);
  }

  for (const e of def.edges) {
    if (!ids.has(e.from)) {
      throw new GraphDefinitionError(`edge.from "${e.from}" is not a declared node`);
    }
    if (e.to !== null && e.to !== '__end__' && !ids.has(e.to)) {
      throw new GraphDefinitionError(`edge.to "${e.to}" is not a declared node`);
    }
  }

  // Every node should be reachable in principle (best-effort; cycles ok).
  const fromSet = new Set(def.edges.map((e) => e.from));
  for (const n of def.nodes) {
    if (n.id !== def.entry && !fromSet.has(n.id) && !def.edges.some((e) => e.to === n.id)) {
      // Isolated non-entry with no edges involving it — warn via throw for quality.
      const involved = def.edges.some((e) => e.from === n.id || e.to === n.id);
      if (!involved) {
        throw new GraphDefinitionError(`node "${n.id}" is unreachable (no edges)`);
      }
    }
  }

  return Object.freeze({
    ...def,
    nodes: Object.freeze([...def.nodes]),
    edges: Object.freeze([...def.edges]),
  });
}
