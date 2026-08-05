/**
 * How a submitted run reaches a worker.
 *
 * Injectable rather than hard-wired, because the right mechanism differs by
 * environment and will change again: async Lambda self-invoke today, and SQS or
 * Step Functions later if runs need to outlive Lambda's 15 minutes. The submit
 * path should not have to know.
 *
 * Local development runs the worker inline. That is *not* a shortcut standing in
 * for the real thing — it is how a developer without deploy access exercises the
 * whole pipeline. It is also why the worker entry point takes a run id and reads
 * everything else from the database: it must behave identically whether invoked
 * across the network or called directly.
 */
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';

export type Dispatcher = (runId: string) => Promise<void>;

let lambda: LambdaClient | null = null;

/**
 * Fire-and-forget invoke of the **worker** function.
 *
 * Deliberately a different function, not this one. A Lambda invoking itself is
 * the shape AWS's recursive-invocation detection exists to catch, and — more
 * practically — one function cannot hold two timeouts, while the API path must
 * fail fast and a run needs the full fifteen minutes.
 *
 * `InvocationType: 'Event'` returns as soon as AWS accepts the request, so the
 * submit response is fast regardless of how long the run takes. Delivery is
 * at-least-once, which is why `claimRun` is conditional on `status = 'queued'`.
 */
export function lambdaDispatcher(functionName: string): Dispatcher {
  return async (runId: string) => {
    lambda ??= new LambdaClient({});
    await lambda.send(
      new InvokeCommand({
        FunctionName: functionName,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify({ walkcroachWorker: { runId } })),
      }),
    );
  };
}

/** Runs the worker in-process. Used locally and in integration tests. */
export function inlineDispatcher(run: (runId: string) => Promise<void>): Dispatcher {
  return async (runId: string) => {
    // Deliberately not awaited: submit must stay fast, and the caller polls for
    // the result exactly as it would in production.
    void run(runId).catch(() => {
      // The worker records its own failure in `agent_runs`; there is nowhere
      // better for this to go, and throwing here would fail the submit for a
      // run that was accepted.
    });
  };
}

/**
 * Resolve a dispatcher from the environment.
 *
 * `WALKCROACH_WORKER_FUNCTION` is set by Terraform to the worker function's
 * name. Without it — locally, or in a test — the worker runs in-process, which
 * degrades to "bounded by this process's lifetime" rather than "runs vanish".
 *
 * That fallback is deliberately *not* silent in a deployed environment: running
 * inline inside the API Lambda would cap a fifteen-minute run at the API
 * timeout, and failing quietly there would look like the run simply stopped.
 */
export function resolveDispatcher(
  runWorker: (runId: string) => Promise<void>,
): Dispatcher {
  const fn = process.env.WALKCROACH_WORKER_FUNCTION;
  if (fn && process.env.WALKCROACH_INLINE_WORKER !== 'true') {
    return lambdaDispatcher(fn);
  }

  if (process.env.AWS_LAMBDA_FUNCTION_NAME && process.env.WALKCROACH_INLINE_WORKER !== 'true') {
    console.warn(
      '[walkcroach] WALKCROACH_WORKER_FUNCTION is unset in a Lambda environment — ' +
        'runs will execute inline and be cut off at this function\'s timeout. ' +
        'Set it to the worker function name.',
    );
  }
  return inlineDispatcher(runWorker);
}
