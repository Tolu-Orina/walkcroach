import type { WalkCroach } from '@walkcroach/sdk';
import {
  cacheable,
  ErrorCode,
  META,
  negotiate,
  PROTOCOL_2026,
  rpcError,
  rpcResult,
  SERVER_INFO,
  SUPPORTED_PROTOCOL_VERSIONS,
  UnsupportedProtocolVersionError,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from './protocol.js';
import { executeTool, getTool, TOOLS } from './tools.js';

/**
 * Transport-agnostic MCP dispatch.
 *
 * Stateless by construction: nothing is retained between calls, so the same
 * instance can serve concurrent requests from unrelated clients. That is the
 * 2026-07-28 model, and it is also the only model that works behind API Gateway
 * + `streamifyResponse`, which holds no cross-call state either.
 */
export type Dispatcher = (req: JsonRpcRequest) => Promise<JsonRpcResponse | null>;

export function createDispatcher(wc: WalkCroach): Dispatcher {
  return async function dispatch(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    const id = req.id ?? null;

    if (req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
      return rpcError(id, ErrorCode.InvalidRequest, 'malformed JSON-RPC request');
    }

    // A notification (no id) gets no response, per JSON-RPC. `notifications/*`
    // from pre-2026 clients land here and are correctly ignored.
    const isNotification = req.id === undefined;

    let ctx;
    try {
      ctx = negotiate(req.params);
    } catch (err) {
      if (err instanceof UnsupportedProtocolVersionError) {
        if (isNotification) return null;
        return rpcError(id, ErrorCode.UnsupportedProtocolVersion, err.message, {
          supported: SUPPORTED_PROTOCOL_VERSIONS,
        });
      }
      throw err;
    }

    switch (req.method) {
      /**
       * Mandatory in 2026-07-28. Clients may call it up front to pick a version,
       * or use it as a backward-compatibility probe.
       */
      case 'server/discover':
        return rpcResult(id, {
          protocolVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
          serverInfo: SERVER_INFO,
          capabilities: {
            tools: { listChanged: false },
            // Roots, sampling, and logging are all deprecated as of this
            // revision (SEP-2577) and deliberately unimplemented.
            extensions: {},
          },
        });

      /**
       * Removed in 2026-07-28 but answered anyway, because every host built on
       * `@modelcontextprotocol/sdk` still sends it. Returning a valid
       * InitializeResult is what makes those hosts able to talk to us at all.
       */
      case 'initialize': {
        const requested = (req.params?.protocolVersion as string | undefined) ?? undefined;
        const agreed =
          requested && (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
            ? requested
            : PROTOCOL_2026;
        return rpcResult(id, {
          protocolVersion: agreed,
          serverInfo: SERVER_INFO,
          capabilities: { tools: { listChanged: false } },
        });
      }

      case 'notifications/initialized':
        return null;

      case 'tools/list':
        return rpcResult(
          id,
          cacheable({
            tools: TOOLS.map((t) => ({
              name: t.name,
              title: t.title,
              description: t.description,
              inputSchema: t.inputSchema,
              outputSchema: t.outputSchema,
            })),
          }),
        );

      case 'tools/call': {
        const name = req.params?.name;
        if (typeof name !== 'string') {
          return rpcError(id, ErrorCode.InvalidParams, 'params.name is required');
        }
        const tool = getTool(name);
        if (!tool) {
          return rpcError(id, ErrorCode.MethodNotFound, `unknown tool: ${name}`);
        }
        const args = (req.params?.arguments ?? {}) as Record<string, unknown>;

        const outcome = await executeTool(wc, name, args);
        return rpcResult(id, {
          content: outcome.content,
          ...(outcome.structuredContent
            ? { structuredContent: outcome.structuredContent }
            : {}),
          ...(outcome.isError ? { isError: true } : {}),
          _meta: ctx.traceparent ? { [META.traceparent]: ctx.traceparent } : {},
        });
      }

      // Present in 2025-11-25, and hosts probe for them. An empty list is a
      // truthful answer and stops a host reporting the server as broken.
      case 'resources/list':
        return rpcResult(id, cacheable({ resources: [] }));
      case 'prompts/list':
        return rpcResult(id, cacheable({ prompts: [] }));

      /**
       * Removed in 2026-07-28 (SEP-2575). Answered for older hosts that send it
       * as a keepalive and treat a failure as a dead connection.
       */
      case 'ping':
        return rpcResult(id, {});

      default:
        if (isNotification) return null;
        return rpcError(id, ErrorCode.MethodNotFound, `unknown method: ${req.method}`);
    }
  };
}
