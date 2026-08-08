/**
 * Graph registry — register definitions once; executor never hard-codes graph ids.
 * Exit criterion #5: a second graph registers without changing executor code.
 */
import type { GraphDefinition, GraphState } from './types.js';
import { GraphDefinitionError } from './define.js';

const REGISTRY = new Map<string, GraphDefinition>();

export function registerGraph<S extends GraphState = GraphState>(
  def: GraphDefinition<S>,
): void {
  if (REGISTRY.has(def.id)) {
    throw new GraphDefinitionError(`graph already registered: ${def.id}`);
  }
  REGISTRY.set(def.id, def as GraphDefinition);
}

export function getGraph(id: string): GraphDefinition | undefined {
  return REGISTRY.get(id);
}

export function listRegisteredGraphs(): string[] {
  return [...REGISTRY.keys()].sort();
}

/** Test helper — clears the process-local registry. */
export function clearGraphRegistry(): void {
  REGISTRY.clear();
}
