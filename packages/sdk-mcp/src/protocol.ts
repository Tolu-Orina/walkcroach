/**
 * MCP wire protocol constants and helpers.
 *
 * Targets the **2026-07-28** revision, which went stable six days before this
 * was written, while still accepting **2025-11-25** clients.
 *
 * The back-compat is not politeness — it is required for the server to work at
 * all today. As of 2026-08-04 the official `@modelcontextprotocol/sdk@1.30.0`
 * (published 2026-07-27, one day before the spec froze) still declares
 * `LATEST_PROTOCOL_VERSION = '2025-11-25'` and ships no `server/discover`. Hosts
 * built on it therefore speak the older revision. A server that answered only
 * 2026-07-28 would be spec-correct and unusable.
 *
 * What 2026-07-28 changed that this file encodes:
 *   * No `initialize` handshake. Every request carries its own protocol version
 *     and client capabilities in `_meta` (SEP-2575).
 *   * No protocol-level sessions, no `Mcp-Session-Id`. Cross-call state travels
 *     as server-minted handles in ordinary tool arguments (SEP-2567).
 *   * Every result carries `resultType`. Absent means `"complete"` (SEP-2322).
 *   * List/read results carry `ttlMs` + `cacheScope` (SEP-2549).
 *   * Error codes -32020..-32099 are reserved for the spec; the ones introduced
 *     in this revision were renumbered.
 */

export const PROTOCOL_2026 = '2026-07-28';
export const PROTOCOL_2025 = '2025-11-25';

/** Newest first — the order `server/discover` advertises. */
export const SUPPORTED_PROTOCOL_VERSIONS = [PROTOCOL_2026, PROTOCOL_2025] as const;
export type ProtocolVersion = (typeof SUPPORTED_PROTOCOL_VERSIONS)[number];

export const SERVER_INFO = {
  name: 'walkcroach-memory',
  title: 'WalkCroach Memory',
  version: '0.1.0',
} as const;

/** `_meta` keys defined by the specification. */
export const META = {
  protocolVersion: 'io.modelcontextprotocol/protocolVersion',
  clientCapabilities: 'io.modelcontextprotocol/clientCapabilities',
  clientInfo: 'io.modelcontextprotocol/clientInfo',
  serverInfo: 'io.modelcontextprotocol/serverInfo',
  logLevel: 'io.modelcontextprotocol/logLevel',
  traceparent: 'traceparent',
} as const;

/**
 * JSON-RPC error codes.
 *
 * -32000..-32019 stays implementation-defined; -32020..-32099 is reserved for
 * the specification. The three below were renumbered in 2026-07-28 (they were
 * -32001/-32003/-32004 in the draft).
 */
export const ErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  HeaderMismatch: -32020,
  MissingRequiredClientCapability: -32021,
  UnsupportedProtocolVersion: -32022,
} as const;

export type JsonRpcId = string | number | null;

export type JsonRpcRequest = {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
};

export type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: JsonRpcId; result: unknown }
  | {
      jsonrpc: '2.0';
      id: JsonRpcId;
      error: { code: number; message: string; data?: unknown };
    };

export function rpcError(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } };
}

/**
 * Wrap a payload as a complete result.
 *
 * `resultType` is required in 2026-07-28 and unknown to 2025-11-25 clients,
 * which ignore extra fields — so it is safe to always emit and avoids branching
 * every result on the negotiated version.
 */
export function rpcResult(
  id: JsonRpcId,
  payload: Record<string, unknown>,
): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    result: {
      resultType: 'complete',
      ...payload,
      _meta: {
        [META.serverInfo]: SERVER_INFO,
        ...((payload._meta as Record<string, unknown>) ?? {}),
      },
    },
  };
}

/**
 * Cache hints required on list/read results by SEP-2549.
 *
 * Always `private`: the tool list is identical per tenant today, but the results
 * these tools return are not, and a shared intermediary that cached one tenant's
 * response for another would be a data leak. `private` costs a little
 * revalidation and removes that class of bug entirely.
 */
export function cacheable<T extends Record<string, unknown>>(
  payload: T,
  ttlMs = 60_000,
): T & { ttlMs: number; cacheScope: 'private' } {
  return { ...payload, ttlMs, cacheScope: 'private' };
}

export type RequestContext = {
  protocolVersion: ProtocolVersion;
  clientInfo: { name?: string; version?: string } | null;
  /** Only set when the client asked for logs on this request. */
  logLevel: string | null;
  traceparent: string | null;
};

export class UnsupportedProtocolVersionError extends Error {
  constructor(readonly requested: string) {
    super(
      `unsupported protocol version "${requested}"; this server supports ${SUPPORTED_PROTOCOL_VERSIONS.join(', ')}`,
    );
    this.name = 'UnsupportedProtocolVersionError';
  }
}

/**
 * Resolve the protocol version for a single request.
 *
 * A missing version is treated as 2025-11-25 rather than rejected: pre-2026
 * clients negotiated once at `initialize` and do not repeat it per request, so
 * requiring `_meta` would break every client that exists today.
 */
export function negotiate(params: Record<string, unknown> | undefined): RequestContext {
  const meta = (params?._meta ?? {}) as Record<string, unknown>;
  const requested = meta[META.protocolVersion];

  let protocolVersion: ProtocolVersion;
  if (requested === undefined || requested === null) {
    protocolVersion = PROTOCOL_2025;
  } else if (
    typeof requested === 'string' &&
    (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
  ) {
    protocolVersion = requested as ProtocolVersion;
  } else {
    throw new UnsupportedProtocolVersionError(String(requested));
  }

  const info = meta[META.clientInfo];
  return {
    protocolVersion,
    clientInfo:
      info && typeof info === 'object' ? (info as { name?: string; version?: string }) : null,
    // Servers MUST NOT emit notifications/message for requests that did not ask
    // for logs, so absence here is meaningful rather than a default.
    logLevel: typeof meta[META.logLevel] === 'string' ? (meta[META.logLevel] as string) : null,
    traceparent:
      typeof meta[META.traceparent] === 'string' ? (meta[META.traceparent] as string) : null,
  };
}
