-- Asynchronous agent runs.
--
-- A publish run reads a repository, drives up to 24 Bedrock iterations, and opens
-- a pull request. That is minutes of work, against an IDE BFF Lambda whose
-- timeout is 60 seconds — so the HTTP request cannot be the job. It submits one.
--
-- The run's state lives here rather than in a request, which also means a client
-- may disconnect, retry, or come back an hour later without losing anything.

CREATE TABLE IF NOT EXISTS agent_runs (
  id              UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id        STRING NOT NULL,
  project_id      UUID NOT NULL,
  kind            STRING NOT NULL,            -- 'content.publish' | 'agent.run'
  status          STRING NOT NULL DEFAULT 'queued',

  -- The full submitted request, so a cold worker can execute without the caller
  -- still being connected.
  request         JSONB NOT NULL,
  result          JSONB,
  error           STRING,

  -- A retried submit must return the existing run rather than starting another.
  -- Without this a flaky network turns one blog post into three pull requests.
  idempotency_key STRING,

  attempts        INT NOT NULL DEFAULT 0,

  -- Heartbeat. A worker that dies mid-run leaves this in the past, and the run
  -- is failed by the reaper rather than sitting on 'running' forever.
  lease_expires_at TIMESTAMPTZ,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ
);

-- "My runs", newest first.
CREATE INDEX IF NOT EXISTS agent_runs_owner_idx
  ON agent_runs (owner_id, created_at DESC);

-- Idempotency is per owner: two customers may legitimately use the same key.
CREATE UNIQUE INDEX IF NOT EXISTS agent_runs_idempotency_idx
  ON agent_runs (owner_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- The reaper's query: runs still marked running whose lease has lapsed.
CREATE INDEX IF NOT EXISTS agent_runs_lease_idx
  ON agent_runs (lease_expires_at)
  WHERE status = 'running';

-- Append-only progress log.
--
-- Polling with `afterSeq` gives streaming-like progress without holding an SSE
-- connection open for minutes — and unlike a stream, it survives the client
-- closing its laptop.
CREATE TABLE IF NOT EXISTS agent_run_events (
  run_id   UUID NOT NULL,
  seq      INT NOT NULL,
  at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  type     STRING NOT NULL,
  payload  JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (run_id, seq)
);
