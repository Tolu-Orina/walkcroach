import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import {
  createApiKey,
  listApiKeys,
  listApiKeyUsage,
  revokeApiKey,
  type ApiKeyScope,
  type ApiKeySummary,
  type ApiKeyUsageRow,
  type CreatedApiKey,
} from '../../api/client';

const SCOPE_OPTIONS: { id: ApiKeyScope; label: string; hint: string }[] = [
  {
    id: 'memory:read',
    label: 'memory:read',
    hint: 'Recall, list, export, asOf, diff, audit',
  },
  {
    id: 'memory:write',
    label: 'memory:write',
    hint: 'Remember, import, erase',
  },
  {
    id: 'content:run',
    label: 'content:run',
    hint: 'Programmatic content publish / agent runs',
  },
];

function formatWhen(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

export function DeveloperKeysPage() {
  const nameId = useId();
  const [keys, setKeys] = useState<ApiKeySummary[] | null>(null);
  const [usageByKey, setUsageByKey] = useState<Record<string, ApiKeyUsageRow>>(
    {},
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<ApiKeyScope[]>(['memory:read', 'memory:write']);
  const [expiresInDays, setExpiresInDays] = useState<string>('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [minted, setMinted] = useState<CreatedApiKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [rows, usage] = await Promise.all([
        listApiKeys(),
        listApiKeyUsage().catch(() => ({ period: 'month', keys: [] as ApiKeyUsageRow[] })),
      ]);
      setKeys(rows.filter((k) => !k.revokedAt));
      const map: Record<string, ApiKeyUsageRow> = {};
      for (const u of usage.keys) map[u.keyId] = u;
      setUsageByKey(map);
      setLoadError(null);
    } catch (err) {
      setKeys(null);
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggleScope = (scope: ApiKeyScope) => {
    setScopes((prev) => {
      if (prev.includes(scope)) {
        const next = prev.filter((s) => s !== scope);
        return next.length === 0 ? prev : next;
      }
      return [...prev, scope];
    });
  };

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setCreateError('Name is required.');
      return;
    }
    setCreating(true);
    setCreateError(null);
    setMinted(null);
    try {
      const days = expiresInDays.trim() ? Number(expiresInDays) : undefined;
      if (days !== undefined && (!Number.isFinite(days) || days < 1 || days > 365)) {
        setCreateError('Expiry must be between 1 and 365 days.');
        setCreating(false);
        return;
      }
      const created = await createApiKey({
        name: trimmed,
        scopes,
        expiresInDays: days,
      });
      setMinted(created);
      setName('');
      setExpiresInDays('');
      await refresh();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  const onCopy = async () => {
    if (!minted?.key) return;
    try {
      await navigator.clipboard.writeText(minted.key);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const onRevoke = async (id: string, keyName: string) => {
    if (
      !window.confirm(
        `Revoke “${keyName}”? Anything using this key will fail immediately.`,
      )
    ) {
      return;
    }
    setRevokingId(id);
    setRevokeError(null);
    try {
      await revokeApiKey(id);
      if (minted?.id === id) setMinted(null);
      await refresh();
    } catch (err) {
      setRevokeError(err instanceof Error ? err.message : String(err));
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {minted && (
        <section
          className="rounded-[var(--radius-control)] border border-signal/40 bg-signal/10 p-5"
          role="status"
        >
          <h2 className="text-sm font-semibold text-paper">Copy your key now</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-mist">
            {minted.warning} Prefix{' '}
            <code className="font-mono text-paper">{minted.prefix}</code>.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-[var(--radius-control)] border border-line bg-ink/60 px-3 py-2 font-mono text-[12px] text-paper">
              {minted.key}
            </code>
            <button
              type="button"
              onClick={() => void onCopy()}
              className="btn-primary shrink-0 text-xs"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <button
            type="button"
            className="btn-ghost mt-3 text-xs"
            onClick={() => setMinted(null)}
          >
            Dismiss
          </button>
        </section>
      )}

      <section className="surface space-y-4 p-5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">
          Create key
        </h2>
        <form onSubmit={(e) => void onCreate(e)} className="space-y-4">
          <div>
            <label htmlFor={nameId} className="text-[12px] font-medium text-mist">
              Name
            </label>
            <input
              id={nameId}
              className="field mt-1.5 w-full"
              placeholder="e.g. ci-prod, local-agent"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              autoComplete="off"
            />
          </div>

          <fieldset>
            <legend className="text-[12px] font-medium text-mist">Scopes</legend>
            <div className="mt-2 space-y-2">
              {SCOPE_OPTIONS.map((opt) => {
                const checked = scopes.includes(opt.id);
                return (
                  <label
                    key={opt.id}
                    className="flex cursor-pointer items-start gap-2.5 rounded-[var(--radius-control)] border border-line bg-ink/30 px-3 py-2.5"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={checked}
                      onChange={() => toggleScope(opt.id)}
                    />
                    <span>
                      <span className="block font-mono text-[12px] text-paper">
                        {opt.label}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-mist">
                        {opt.hint}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div>
            <label
              htmlFor={`${nameId}-expires`}
              className="text-[12px] font-medium text-mist"
            >
              Expires in days{' '}
              <span className="font-normal text-mist/70">(optional, 1–365)</span>
            </label>
            <input
              id={`${nameId}-expires`}
              type="number"
              min={1}
              max={365}
              className="field mt-1.5 w-full sm:w-40"
              placeholder="Never"
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value)}
            />
          </div>

          {createError && <p className="text-sm text-ember">{createError}</p>}

          <button
            type="submit"
            className="btn-primary text-xs"
            disabled={creating}
          >
            {creating ? 'Creating…' : 'Create API key'}
          </button>
        </form>
        <p className="text-[12px] leading-relaxed text-mist">
          Keys are server-side credentials. The SDK refuses to accept them in a
          browser unless you explicitly opt in — use them from Node, workers, or
          CI.
        </p>
      </section>

      <section className="surface space-y-4 p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">
            Active keys
          </h2>
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={() => void refresh()}
          >
            Refresh
          </button>
        </div>

        {loadError && (
          <p className="text-sm text-ember">
            Could not load keys. Is the IDE API running?{' '}
            <span className="font-mono text-[11px] text-mist">
              {loadError.slice(0, 120)}
            </span>
          </p>
        )}
        {!loadError && keys === null && (
          <p className="text-sm text-mist">Loading…</p>
        )}
        {!loadError && keys && keys.length === 0 && (
          <p className="text-sm text-mist">
            No keys yet. Create one above to call{' '}
            <code className="font-mono text-paper">@walkcroach/sdk</code> from
            your own agents.
          </p>
        )}
        {revokeError && <p className="text-sm text-ember">{revokeError}</p>}
        {keys && keys.length > 0 && (
          <ul className="divide-y divide-line/70">
            {keys.map((key) => (
              <li
                key={key.id}
                className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-paper">
                    {key.name}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-mist">
                    {key.prefix}… · {key.scopes.join(', ')}
                  </p>
                  <p className="mt-1 text-[11px] text-mist/80">
                    Created {formatWhen(key.createdAt)}
                    {key.lastUsedAt
                      ? ` · Last used ${formatWhen(key.lastUsedAt)}`
                      : ' · Never used'}
                    {key.expiresAt
                      ? ` · Expires ${formatWhen(key.expiresAt)}`
                      : ''}
                  </p>
                  {usageByKey[key.id] ? (
                    <p className="mt-1 font-mono text-[11px] text-mist">
                      This month: {usageByKey[key.id]!.remember} remember ·{' '}
                      {usageByKey[key.id]!.recall} recall ·{' '}
                      {usageByKey[key.id]!.credits} credits
                    </p>
                  ) : (
                    <p className="mt-1 text-[11px] text-mist/70">
                      This month: no metered API-key usage yet
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  className="btn-secondary shrink-0 self-start text-xs text-ember"
                  disabled={revokingId === key.id}
                  onClick={() => void onRevoke(key.id, key.name)}
                >
                  {revokingId === key.id ? 'Revoking…' : 'Revoke'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
