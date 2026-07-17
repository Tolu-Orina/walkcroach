import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
  Context,
} from 'aws-lambda';
import { handleRest } from './rest.js';

/**
 * Non-streaming REST (used by local-server).
 * Lambda uses the same handleRest via lambda-handler.
 */
export async function handler(
  event: APIGatewayProxyEventV2,
  _context: Context,
): Promise<APIGatewayProxyResultV2> {
  const method = event.requestContext.http.method;
  const path = event.rawPath;
  return handleRest(method, path, event.body ?? undefined, event.pathParameters ?? {});
}
