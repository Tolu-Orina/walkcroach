/**
 * Phase 6b — public Run Graph DSL catalog (ADR-I).
 *
 * Platform nodes only. Customers compose catalog ids; they never register
 * tools, HostAdapters, or arbitrary code. BYO payloads fail closed at validate.
 */

export const GRAPH_RUN_CONTRACT_VERSION = 'graph.run/v1' as const;

/** Hard ceiling — quality attribute: no unbounded customer graphs. */
export const PUBLIC_MAX_NODE_EXECUTIONS_CAP = 40;
export const PUBLIC_MAX_NODES = 24;
export const PUBLIC_MAX_EDGES = 48;

/**
 * Closed predicate names for conditional edges.
 * No customer JS — only named state checks the platform understands.
 */
export const PUBLIC_EDGE_PREDICATES = [
  'always',
  'criticPass',
  'notCriticPass',
  'pipelineOk',
  'pipelineFailed',
  'hasArtifacts',
  'noArtifacts',
] as const;

export type PublicEdgePredicate = (typeof PUBLIC_EDGE_PREDICATES)[number];

/**
 * Closed platform node types (v1).
 * `content.publish` is a **preset**, not an inline node type in customer graphs.
 */
export const PLATFORM_NODE_TYPES = [
  'fence',
  'plan',
  'draft',
  'implement', // alias of draft
  'critique',
  'revise',
  'remember',
  'memory.recall',
  'memory.remember',
] as const;

export type PlatformNodeType = (typeof PLATFORM_NODE_TYPES)[number];

export const PLATFORM_PRESETS = ['content.publish'] as const;
export type PlatformPresetId = (typeof PLATFORM_PRESETS)[number];

export type CatalogNodeInfo = {
  type: PlatformNodeType;
  kind: 'code' | 'agent' | 'subagent' | 'gate';
  description: string;
  /** Config keys accepted under `node.config` (others rejected). */
  configKeys: readonly string[];
};

export const PLATFORM_NODE_CATALOG: readonly CatalogNodeInfo[] = [
  {
    type: 'fence',
    kind: 'code',
    description: 'Fence untrusted text into delimited context (injection mitigation).',
    configKeys: ['label', 'purpose'],
  },
  {
    type: 'plan',
    kind: 'subagent',
    description: 'Schema-restricted Planner subagent (auto-approve on async SDK).',
    configKeys: [],
  },
  {
    type: 'draft',
    kind: 'agent',
    description: 'Implement / draft with an approved plan injected.',
    configKeys: [],
  },
  {
    type: 'implement',
    kind: 'agent',
    description: 'Alias of draft.',
    configKeys: [],
  },
  {
    type: 'critique',
    kind: 'gate',
    description: 'Deterministic CriticGate floor (forbidden imports, red flags, schema).',
    configKeys: ['allowedImportPrefixes', 'minArtifacts'],
  },
  {
    type: 'revise',
    kind: 'agent',
    description: 'Revise draft using CriticGate revise prompt.',
    configKeys: [],
  },
  {
    type: 'remember',
    kind: 'code',
    description: 'Persist house-style / convention learnings to project memory.',
    configKeys: [],
  },
  {
    type: 'memory.recall',
    kind: 'code',
    description: 'Recall project memory into state.hits / state.context.',
    configKeys: ['query', 'limit'],
  },
  {
    type: 'memory.remember',
    kind: 'code',
    description: 'Write state.rememberText (or input text) into project memory.',
    configKeys: ['kind', 'textKey'],
  },
] as const;

export type PublicGraphNode = {
  id: string;
  type: string;
  config?: Record<string, unknown>;
};

export type PublicGraphEdge = {
  from: string;
  /** null or "__end__" = terminal. */
  to: string | null;
  when?: string;
};

export type PublicGraphDefinition = {
  /** Optional customer label (not a registry key). */
  id?: string;
  entry: string;
  maxNodeExecutions: number;
  nodes: PublicGraphNode[];
  edges: PublicGraphEdge[];
};

/** Keys that indicate BYO-tools / HostAdapter smuggling — always reject. */
export const BYO_FORBIDDEN_KEYS = [
  'tools',
  'tool',
  'toolDefs',
  'hostAdapter',
  'HostAdapter',
  'code',
  'run',
  'fn',
  'handler',
  'lambda',
  'customNodes',
  'byo',
  'plugin',
  'plugins',
  'sandbox',
  'agentEngine',
  'criticGateSchema',
] as const;

export type PublicGraphValidation =
  | { ok: true; graph: PublicGraphDefinition; normalized: PublicGraphDefinition }
  | { ok: false; errors: string[] };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function collectByoKeys(value: unknown, path: string, out: string[]): void {
  if (!isPlainObject(value) && !Array.isArray(value)) return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => collectByoKeys(item, `${path}[${i}]`, out));
    return;
  }
  for (const [k, v] of Object.entries(value)) {
    const p = path ? `${path}.${k}` : k;
    if (
      (BYO_FORBIDDEN_KEYS as readonly string[]).includes(k) ||
      /^tool[A-Z_]/.test(k) ||
      k.toLowerCase() === 'hostadapter'
    ) {
      out.push(`BYO/forbidden key "${k}" at ${p || '(root)'}`);
    }
    collectByoKeys(v, p, out);
  }
}

export function listCatalogNodes(): CatalogNodeInfo[] {
  return [...PLATFORM_NODE_CATALOG];
}

export function listPresets(): Array<{ id: PlatformPresetId; description: string }> {
  return [
    {
      id: 'content.publish',
      description:
        'Named preset: Fence → Plan → Draft → Critique⇄Revise → OpenPR → Remember (same as POST /content/publish).',
    },
  ];
}

/**
 * Validate a public graph definition. Fail closed on unknown types, BYO keys,
 * illegal predicates, and bound violations.
 */
export function validatePublicGraph(raw: unknown): PublicGraphValidation {
  const errors: string[] = [];
  collectByoKeys(raw, '', errors);

  if (!isPlainObject(raw)) {
    return { ok: false, errors: ['graph must be an object', ...errors] };
  }

  if (typeof raw.entry !== 'string' || !raw.entry.trim()) {
    errors.push('entry is required');
  }
  const maxNodeExecutions = Number(raw.maxNodeExecutions);
  if (!Number.isFinite(maxNodeExecutions) || maxNodeExecutions < 1) {
    errors.push('maxNodeExecutions must be >= 1');
  } else if (maxNodeExecutions > PUBLIC_MAX_NODE_EXECUTIONS_CAP) {
    errors.push(
      `maxNodeExecutions exceeds cap (${PUBLIC_MAX_NODE_EXECUTIONS_CAP})`,
    );
  }

  if (!Array.isArray(raw.nodes) || raw.nodes.length === 0) {
    errors.push('nodes must be a non-empty array');
  } else if (raw.nodes.length > PUBLIC_MAX_NODES) {
    errors.push(`nodes exceeds cap (${PUBLIC_MAX_NODES})`);
  }

  if (!Array.isArray(raw.edges)) {
    errors.push('edges must be an array');
  } else if (raw.edges.length > PUBLIC_MAX_EDGES) {
    errors.push(`edges exceeds cap (${PUBLIC_MAX_EDGES})`);
  }

  const allowedTypes = new Set<string>(PLATFORM_NODE_TYPES);
  const ids = new Set<string>();
  const nodes: PublicGraphNode[] = [];

  if (Array.isArray(raw.nodes)) {
    for (const [i, n] of raw.nodes.entries()) {
      if (!isPlainObject(n)) {
        errors.push(`nodes[${i}] must be an object`);
        continue;
      }
      const id = typeof n.id === 'string' ? n.id.trim() : '';
      const type = typeof n.type === 'string' ? n.type.trim() : '';
      if (!id) errors.push(`nodes[${i}].id is required`);
      if (ids.has(id)) errors.push(`duplicate node id "${id}"`);
      if (id) ids.add(id);
      if (!type) errors.push(`nodes[${i}].type is required`);
      else if (!allowedTypes.has(type)) {
        errors.push(
          `nodes[${i}].type "${type}" is not in the platform catalog (BYO nodes rejected)`,
        );
      }
      if (type === 'content.publish') {
        errors.push(
          'content.publish is a preset — use { preset: "content.publish" }, not a node type',
        );
      }
      const config = n.config;
      if (config !== undefined && !isPlainObject(config)) {
        errors.push(`nodes[${i}].config must be an object when set`);
      } else if (isPlainObject(config)) {
        const info = PLATFORM_NODE_CATALOG.find((c) => c.type === type);
        if (info) {
          for (const key of Object.keys(config)) {
            if (!(info.configKeys as readonly string[]).includes(key)) {
              errors.push(
                `nodes[${i}].config.${key} is not allowed for type "${type}"`,
              );
            }
          }
        }
      }
      if (id && type && allowedTypes.has(type)) {
        nodes.push({
          id,
          type,
          ...(isPlainObject(config) ? { config } : {}),
        });
      }
    }
  }

  const entry = typeof raw.entry === 'string' ? raw.entry.trim() : '';
  if (entry && ids.size > 0 && !ids.has(entry)) {
    errors.push(`entry "${entry}" is not a declared node`);
  }

  const edges: PublicGraphEdge[] = [];
  const predSet = new Set<string>(PUBLIC_EDGE_PREDICATES);
  if (Array.isArray(raw.edges)) {
    for (const [i, e] of raw.edges.entries()) {
      if (!isPlainObject(e)) {
        errors.push(`edges[${i}] must be an object`);
        continue;
      }
      const from = typeof e.from === 'string' ? e.from.trim() : '';
      const toRaw = e.to;
      const to =
        toRaw === null || toRaw === '__end__'
          ? null
          : typeof toRaw === 'string'
            ? toRaw.trim()
            : undefined;
      if (!from) errors.push(`edges[${i}].from is required`);
      else if (ids.size > 0 && !ids.has(from)) {
        errors.push(`edges[${i}].from "${from}" is not a declared node`);
      }
      if (to === undefined) {
        errors.push(`edges[${i}].to must be a node id, null, or "__end__"`);
      } else if (to !== null && ids.size > 0 && !ids.has(to)) {
        errors.push(`edges[${i}].to "${to}" is not a declared node`);
      }
      let when: string | undefined;
      if (e.when !== undefined) {
        if (typeof e.when !== 'string' || !predSet.has(e.when)) {
          errors.push(
            `edges[${i}].when must be one of: ${PUBLIC_EDGE_PREDICATES.join(', ')}`,
          );
        } else {
          when = e.when;
        }
      }
      if (from && to !== undefined) {
        edges.push({ from, to, ...(when ? { when } : {}) });
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const normalized: PublicGraphDefinition = {
    ...(typeof raw.id === 'string' && raw.id.trim()
      ? { id: raw.id.trim() }
      : {}),
    entry,
    maxNodeExecutions,
    nodes,
    edges,
  };
  return { ok: true, graph: normalized, normalized };
}
