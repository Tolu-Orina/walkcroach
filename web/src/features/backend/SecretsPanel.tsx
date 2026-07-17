import { useCallback, useEffect, useState } from 'react';
import { getProjectSecrets, putProjectSecret } from '../../api/client';

type SecretsPanelProps = {
  projectId: string;
};

export function SecretsPanel({ projectId }: SecretsPanelProps) {
  const [keys, setKeys] = useState<Array<{ key: string; masked: string }>>([]);
  const [keyName, setKeyName] = useState('');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await getProjectSecrets(projectId);
      setKeys(data.secrets);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyName.trim() || !value) return;
    setBusy(true);
    setError(null);
    try {
      await putProjectSecret(projectId, keyName.trim(), value);
      setValue('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-t border-line px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-mist">Secrets vault</p>
      <p className="mt-0.5 text-[10px] text-mist/80">
        Write-only — values never shown again. Used via proxy in generated apps.
      </p>

      {keys.length > 0 && (
        <ul className="mt-2 space-y-1">
          {keys.map((s) => (
            <li key={s.key} className="flex justify-between font-mono text-[10px] text-mist">
              <span>{s.key}</span>
              <span>{s.masked}</span>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={(e) => void onSubmit(e)} className="mt-2 flex flex-col gap-1.5">
        <input
          value={keyName}
          onChange={(e) => setKeyName(e.target.value)}
          placeholder="STRIPE_API_KEY"
          className="rounded-sm border border-line bg-ink/60 px-2 py-1 text-[11px] text-paper outline-none focus:border-signal/50"
          disabled={busy}
        />
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Secret value"
          className="rounded-sm border border-line bg-ink/60 px-2 py-1 text-[11px] text-paper outline-none focus:border-signal/50"
          disabled={busy}
        />
        <button
          type="submit"
          disabled={busy || !keyName.trim() || !value}
          className="self-start rounded-sm border border-line px-2 py-1 text-[10px] text-mist hover:border-signal/40 hover:text-paper disabled:opacity-40"
        >
          Store secret
        </button>
      </form>
      {error && <p className="mt-1 text-[10px] text-ember">{error}</p>}
    </div>
  );
}
