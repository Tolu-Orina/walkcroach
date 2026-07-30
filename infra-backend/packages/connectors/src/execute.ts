import { getAction, validateActionArgs, type ActionId } from './actions.js';
import { getProvider } from './providers.js';
import { isExpired, refreshAccessToken, type TokenSet } from './oauth.js';
import { loadTokens, storeTokens } from './vault.js';
import {
  claimRunForExecution,
  getConnector,
  markConnectorError,
  markRunExecuted,
  markRunFailed,
  type DbLike,
} from './store.js';

/**
 * Execute a confirmed connector action.
 *
 * The order of checks here is the security contract, and it is deliberately
 * paranoid — by the time this runs, the arguments have already passed through a
 * language model that may have read attacker-controlled page content:
 *
 *   1. Claim the run atomically, so a confirmed action executes exactly once.
 *   2. Re-validate the arguments from the *stored proposal*, never from the
 *      request body. The client cannot substitute a different recipient between
 *      seeing the confirm card and clicking it.
 *   3. Resolve the connector and check it is still connected and owned.
 *   4. Only then read the token, refresh if needed, and call the provider.
 *
 * Step 2 is the one that matters most: without it, "confirm" would be an
 * unauthenticated write endpoint taking arbitrary arguments.
 */

export type ExecuteResult =
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; error: string; status?: number };

export type ProviderCall = (input: {
  actionId: ActionId;
  args: Record<string, unknown>;
  accessToken: string;
}) => Promise<Record<string, unknown>>;

/** Live provider HTTP calls, injectable so tests never touch the network. */
export const defaultProviderCall: ProviderCall = async ({
  actionId,
  args,
  accessToken,
}) => {
  const auth = { authorization: `Bearer ${accessToken}` };
  const json = { ...auth, 'content-type': 'application/json' };

  switch (actionId) {
    case 'calendar.list_events': {
      const url = new URL(
        'https://www.googleapis.com/calendar/v3/calendars/primary/events',
      );
      url.searchParams.set('timeMin', String(args.timeMin));
      url.searchParams.set('timeMax', String(args.timeMax));
      url.searchParams.set('singleEvents', 'true');
      url.searchParams.set('orderBy', 'startTime');
      url.searchParams.set('maxResults', String(args.maxResults ?? 10));
      return callJson(url.toString(), { headers: auth });
    }
    case 'calendar.create_event': {
      const body = {
        summary: args.summary,
        description: args.description,
        location: args.location,
        start: { dateTime: args.start },
        end: { dateTime: args.end },
        attendees: ((args.attendees as string[]) ?? []).map((email) => ({
          email,
        })),
      };
      return callJson(
        'https://www.googleapis.com/calendar/v3/calendars/primary/events',
        { method: 'POST', headers: json, body: JSON.stringify(body) },
      );
    }
    case 'gmail.draft':
    case 'gmail.send': {
      const raw = buildRfc822(args);
      const path =
        actionId === 'gmail.send'
          ? 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'
          : 'https://gmail.googleapis.com/gmail/v1/users/me/drafts';
      const body =
        actionId === 'gmail.send'
          ? { raw }
          : { message: { raw } };
      return callJson(path, {
        method: 'POST',
        headers: json,
        body: JSON.stringify(body),
      });
    }
    case 'slack.post_message':
      return callJson('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ channel: args.channel, text: args.text }),
      });
    case 'stripe.balance':
      return callJson('https://api.stripe.com/v1/balance', { headers: auth });
    case 'stripe.recent_payments': {
      const url = new URL('https://api.stripe.com/v1/charges');
      url.searchParams.set('limit', String(args.limit ?? 10));
      return callJson(url.toString(), { headers: auth });
    }
  }
};

async function callJson(
  url: string,
  init: RequestInit,
): Promise<Record<string, unknown>> {
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const message =
      (data.error as { message?: string } | undefined)?.message ??
      (typeof data.error === 'string' ? data.error : null) ??
      `provider returned ${res.status}`;
    throw new Error(String(message));
  }
  // Slack returns HTTP 200 with ok:false.
  if (data.ok === false) {
    throw new Error(String(data.error ?? 'provider rejected the request'));
  }
  return data;
}

/**
 * Minimal RFC 822 for Gmail.
 *
 * Header values come from `validateActionArgs`, which has already rejected CR
 * and LF in single-line fields — that check is what prevents header injection
 * from inserting an extra `Bcc:` here.
 */
export function buildRfc822(args: Record<string, unknown>): string {
  const to = ((args.to as string[]) ?? []).join(', ');
  const cc = ((args.cc as string[]) ?? []).join(', ');
  const lines = [
    `To: ${to}`,
    cc ? `Cc: ${cc}` : null,
    `Subject: ${String(args.subject ?? '')}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    String(args.body ?? ''),
  ].filter((l) => l !== null);
  return Buffer.from(lines.join('\r\n'), 'utf8').toString('base64url');
}

export type ExecuteInput = {
  db: DbLike;
  ownerId: string;
  runId: string;
  /** Injected in tests; defaults to real provider HTTP. */
  providerCall?: ProviderCall;
  env?: NodeJS.ProcessEnv;
  now?: number;
};

export async function executeRun(input: ExecuteInput): Promise<ExecuteResult> {
  const { db, ownerId, runId } = input;

  // 1. Claim. Idempotent by construction — a second confirm finds nothing.
  const run = await claimRunForExecution(db, ownerId, runId);
  if (!run) {
    return { ok: false, error: 'this action is no longer pending', status: 409 };
  }

  const action = getAction(run.action);
  if (!action) {
    await markRunFailed(db, { ownerId, runId, error: 'unknown action' });
    return { ok: false, error: 'unknown action', status: 400 };
  }

  // 2. Re-validate from the stored proposal, not from anything the client sent.
  const proposedArgs =
    (run.proposed_action as { args?: unknown })?.args ?? run.proposed_action;
  const validated = validateActionArgs(run.action, proposedArgs);
  if (!validated.ok) {
    await markRunFailed(db, { ownerId, runId, error: validated.error });
    return { ok: false, error: validated.error, status: 400 };
  }

  // 3. Connector must still exist, be owned, and be connected.
  const connector = await getConnector(db, ownerId, action.provider);
  if (!connector || connector.status === 'revoked') {
    const error = `${action.provider} is not connected`;
    await markRunFailed(db, { ownerId, runId, error });
    return { ok: false, error, status: 409 };
  }
  if (!getProvider(connector.provider)) {
    const error = 'unknown provider';
    await markRunFailed(db, { ownerId, runId, error });
    return { ok: false, error, status: 400 };
  }

  // 4. Token, refreshed if needed. This is the only place a token is read.
  let tokens = await loadTokens(connector.secret_ref);
  if (!tokens) {
    const error = 'connection needs to be re-authorised';
    await markConnectorError(db, ownerId, connector.provider, error);
    await markRunFailed(db, { ownerId, runId, error });
    return { ok: false, error, status: 409 };
  }

  if (isExpired(tokens, input.now) && tokens.refreshToken) {
    const refreshed = await refreshAccessToken({
      providerId: connector.provider,
      refreshToken: tokens.refreshToken,
      env: input.env,
      now: input.now,
    });
    if ('error' in refreshed) {
      await markConnectorError(db, ownerId, connector.provider, refreshed.error);
      await markRunFailed(db, { ownerId, runId, error: refreshed.error });
      return { ok: false, error: 'connection expired', status: 409 };
    }
    tokens = refreshed satisfies TokenSet;
    await storeTokens(connector.secret_ref, tokens);
  }

  try {
    const call = input.providerCall ?? defaultProviderCall;
    const result = await call({
      actionId: action.id,
      args: validated.args,
      accessToken: tokens.accessToken,
    });
    const summary = summarise(action.id, result);
    await markRunExecuted(db, { ownerId, runId, result: summary });
    return { ok: true, result: summary };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'provider call failed';
    await markConnectorError(db, ownerId, connector.provider, error);
    await markRunFailed(db, { ownerId, runId, error });
    return { ok: false, error, status: 502 };
  }
}

/**
 * Keep only what a surface needs to render, and drop the rest.
 *
 * Provider responses are large and can contain personal data well beyond what
 * the action asked for — a calendar list includes every attendee's email. This
 * is both a payload and a data-minimisation concern.
 */
export function summarise(
  actionId: ActionId,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  switch (actionId) {
    case 'calendar.list_events': {
      const items = (raw.items as Array<Record<string, unknown>>) ?? [];
      return {
        events: items.slice(0, 25).map((e) => ({
          id: e.id,
          summary: e.summary ?? '(no title)',
          start: (e.start as { dateTime?: string; date?: string })?.dateTime ??
            (e.start as { date?: string })?.date ?? null,
          end: (e.end as { dateTime?: string; date?: string })?.dateTime ??
            (e.end as { date?: string })?.date ?? null,
        })),
      };
    }
    case 'calendar.create_event':
      return { id: raw.id, htmlLink: raw.htmlLink, summary: raw.summary };
    case 'gmail.draft':
      return { draftId: raw.id };
    case 'gmail.send':
      return { messageId: raw.id, threadId: raw.threadId };
    case 'slack.post_message':
      return { channel: raw.channel, ts: raw.ts };
    case 'stripe.balance': {
      const pick = (list: unknown) =>
        ((list as Array<Record<string, unknown>>) ?? []).map((b) => ({
          amount: b.amount,
          currency: b.currency,
        }));
      return { available: pick(raw.available), pending: pick(raw.pending) };
    }
    case 'stripe.recent_payments': {
      const data = (raw.data as Array<Record<string, unknown>>) ?? [];
      return {
        payments: data.slice(0, 25).map((c) => ({
          id: c.id,
          amount: c.amount,
          currency: c.currency,
          created: c.created,
          description: c.description ?? null,
        })),
      };
    }
  }
}
