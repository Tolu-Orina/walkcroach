import type { Transport } from './http.js';

export type EnsuredProject = {
  id: string;
  name: string;
  kind: string;
  surfaceOrigin: string;
  created: boolean;
};

/**
 * Project helpers for API-key callers.
 *
 * `ensure()` get-or-creates the reserved `__walkcroach_sdk__` project so you
 * never have to copy a UUID out of the web app to try the SDK.
 *
 * Path is `/v1/content/ensure-project` (not `/v1/projects/…`) because the
 * shared API Gateway already owns `/projects` for the Cognito App Builder.
 */
export class ProjectsApi {
  constructor(private readonly transport: Transport) {}

  /**
   * Resolve the default SDK project for this credential, creating it when
   * missing. Idempotent.
   */
  async ensure(opts: { name?: string } = {}): Promise<EnsuredProject> {
    return this.transport.request('POST', '/v1/content/ensure-project', {
      body: opts.name ? { name: opts.name } : {},
    });
  }
}
