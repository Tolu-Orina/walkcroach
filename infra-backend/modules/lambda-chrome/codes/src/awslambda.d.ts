/// <reference types="node" />

/**
 * Provided by the AWS Lambda Node.js runtime when using response streaming.
 */
declare const awslambda: {
  streamifyResponse: (
    handler: (
      event: unknown,
      responseStream: NodeJS.WritableStream,
      context: unknown,
    ) => Promise<void>,
  ) => (event: unknown, context: unknown) => unknown;
  HttpResponseStream: {
    from: (
      stream: NodeJS.WritableStream,
      metadata: {
        statusCode: number;
        headers?: Record<string, string>;
      },
    ) => NodeJS.WritableStream;
  };
};
