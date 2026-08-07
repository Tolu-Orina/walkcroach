import { useState, useCallback, useEffect } from 'react';
import { getVsCodeApi } from './vscodeApi';

export type McpServerRow = {
  name: string;
  transport: 'http' | 'stdio';
  detail: string;
  pid?: number | null;
  running: boolean;
  approved?: boolean;
  blockedReason?: string;
};

type Props = {
  bedrockConfigured: boolean;
  bedrockModelId: string;
  bedrockRegion: string;
  reasoningEffort: string;
  mcpConfigured: boolean;
  ccloudConfigured: boolean;
  mcpServers: McpServerRow[];
  mcpStdioAllowed: boolean;
  onBack: () => void;
};

const REGION_OPTIONS = [
  'us-east-1',
  'us-east-2',
  'us-west-2',
  'eu-west-1',
  'eu-west-2',
  'eu-central-1',
  'ap-northeast-1',
  'ap-southeast-1',
  'ap-southeast-2',
];

const REASONING_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Default (medium)' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

/**
 * Credentials page — secrets go to the host SecretStorage only.
 * Never echo stored values back into the webview (industry standard).
 */
export function SettingsView({
  bedrockConfigured,
  bedrockModelId,
  bedrockRegion,
  reasoningEffort,
  mcpConfigured,
  ccloudConfigured,
  mcpServers,
  mcpStdioAllowed,
  onBack,
}: Props) {
  const [bedrockKey, setBedrockKey] = useState('');
  const [modelId, setModelId] = useState(bedrockModelId);
  const [region, setRegion] = useState(bedrockRegion || 'eu-west-2');
  const [effort, setEffort] = useState(reasoningEffort);
  const [mcpSnippet, setMcpSnippet] = useState('');
  const [clusterId, setClusterId] = useState('');
  const [mcpApiKey, setMcpApiKey] = useState('');
  const [ccloudKey, setCcloudKey] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setModelId(bedrockModelId);
  }, [bedrockModelId]);

  useEffect(() => {
    setRegion(bedrockRegion || 'eu-west-2');
  }, [bedrockRegion]);

  useEffect(() => {
    setEffort(reasoningEffort);
  }, [reasoningEffort]);

  const saveBedrock = useCallback(() => {
    const token = bedrockKey.trim();
    if (!token) return;
    setBusy(true);
    getVsCodeApi().postMessage({
      type: 'SAVE_SETTINGS',
      bedrockApiKey: token,
    });
    setBedrockKey('');
    setBusy(false);
  }, [bedrockKey]);

  const clearBedrock = useCallback(() => {
    setBusy(true);
    getVsCodeApi().postMessage({
      type: 'SAVE_SETTINGS',
      bedrockApiKey: null,
    });
    setBedrockKey('');
    setBusy(false);
  }, []);

  const saveRegion = useCallback(
    (value: string) => {
      const next = value.trim() || 'eu-west-2';
      setRegion(next);
      setBusy(true);
      getVsCodeApi().postMessage({
        type: 'SAVE_SETTINGS',
        bedrockRegion: next,
      });
      setBusy(false);
    },
    [],
  );

  const saveModelId = useCallback(() => {
    setBusy(true);
    const trimmed = modelId.trim();
    getVsCodeApi().postMessage({
      type: 'SAVE_SETTINGS',
      bedrockModelId: trimmed || null,
    });
    setBusy(false);
  }, [modelId]);

  const saveEffort = useCallback(
    (value: string) => {
      setEffort(value);
      setBusy(true);
      getVsCodeApi().postMessage({
        type: 'SAVE_SETTINGS',
        reasoningEffort: value || null,
      });
      setBusy(false);
    },
    [],
  );

  const saveMcpSnippet = useCallback(() => {
    if (!mcpSnippet.trim()) return;
    setBusy(true);
    getVsCodeApi().postMessage({
      type: 'SAVE_SETTINGS',
      mcpSnippet: mcpSnippet.trim(),
    });
    setMcpSnippet('');
    setBusy(false);
  }, [mcpSnippet]);

  const saveMcpManual = useCallback(() => {
    if (!clusterId.trim() || !mcpApiKey.trim()) return;
    setBusy(true);
    getVsCodeApi().postMessage({
      type: 'SAVE_SETTINGS',
      mcpClusterId: clusterId.trim(),
      mcpApiKey: mcpApiKey.trim(),
      ccloudApiKey: ccloudKey.trim() || undefined,
    });
    setMcpApiKey('');
    setCcloudKey('');
    setBusy(false);
  }, [clusterId, mcpApiKey, ccloudKey]);

  const clearMcp = useCallback(() => {
    setBusy(true);
    getVsCodeApi().postMessage({
      type: 'SAVE_SETTINGS',
      clearMcp: true,
    });
    setClusterId('');
    setMcpApiKey('');
    setMcpSnippet('');
    setCcloudKey('');
    setBusy(false);
  }, []);

  return (
    <div className="settings">
      <header className="settings-top">
        <button type="button" className="linkish" onClick={onBack}>
          ← Chat
        </button>
        <span className="brand">Setup</span>
      </header>

      <p className="settings-lead">
        Keys stay in your OS credential store via VS Code SecretStorage — never
        in settings.json or the chat transcript.
      </p>

      <section className="settings-card" aria-labelledby="bedrock-h">
        <div className="settings-card-head">
          <h2 id="bedrock-h">Amazon Bedrock</h2>
          <span className={`status-dot ${bedrockConfigured ? 'on' : ''}`}>
            {bedrockConfigured ? 'Ready' : 'Needed'}
          </span>
        </div>
        <p className="settings-hint">
          Paste a Bedrock API key, or rely on AWS credentials already available
          to this IDE process. Short-term keys only work in the AWS region where
          you created them — set that region below (console default is often{' '}
          <code>us-east-1</code>).
        </p>
        <label className="label" htmlFor="bedrock-key">
          Bedrock API key
        </label>
        <input
          id="bedrock-key"
          className="field"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={bedrockConfigured ? '•••••••• (replace)' : 'Paste key'}
          value={bedrockKey}
          onChange={(e) => setBedrockKey(e.target.value)}
        />
        <div className="row">
          <button
            type="button"
            className="btn primary"
            disabled={busy || !bedrockKey.trim()}
            onClick={saveBedrock}
          >
            Save
          </button>
          {bedrockConfigured ? (
            <button
              type="button"
              className="btn ghost"
              disabled={busy}
              onClick={clearBedrock}
            >
              Clear
            </button>
          ) : null}
        </div>

        <label className="label" htmlFor="bedrock-region">
          Bedrock region
        </label>
        <p className="settings-hint">
          Must match the region of your API key. Mismatch causes
          &quot;Authentication failed: Please make sure your API Key is
          valid.&quot;
        </p>
        <select
          id="bedrock-region"
          className="field"
          value={region}
          disabled={busy}
          onChange={(e) => saveRegion(e.target.value)}
        >
          {REGION_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
          {!REGION_OPTIONS.includes(region) ? (
            <option value={region}>{region}</option>
          ) : null}
        </select>

        <label className="label" htmlFor="bedrock-model">
          Model ID (optional override)
        </label>
        <p className="settings-hint">
          Default is Nova 2 Lite (
          <code>global.amazon.nova-2-lite-v1:0</code>). Leave empty to keep the
          default.
        </p>
        <input
          id="bedrock-model"
          className="field"
          autoComplete="off"
          spellCheck={false}
          placeholder="global.amazon.nova-2-lite-v1:0"
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
        />
        <div className="row">
          <button
            type="button"
            className="btn primary"
            disabled={busy || modelId.trim() === bedrockModelId.trim()}
            onClick={saveModelId}
          >
            Save model
          </button>
          {bedrockModelId ? (
            <button
              type="button"
              className="btn ghost"
              disabled={busy}
              onClick={() => {
                setModelId('');
                getVsCodeApi().postMessage({
                  type: 'SAVE_SETTINGS',
                  bedrockModelId: null,
                });
              }}
            >
              Reset default
            </button>
          ) : null}
        </div>

        <label className="label" htmlFor="reasoning-effort">
          Extended thinking
        </label>
        <p className="settings-hint">
          Nova 2 Lite extended thinking is always on. Choose the effort tier —
          medium is the default (same as WalkCroach Web). High disables the
          output-token cap and is slower.
        </p>
        <select
          id="reasoning-effort"
          className="field"
          value={effort}
          disabled={busy}
          onChange={(e) => saveEffort(e.target.value)}
        >
          {REASONING_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </section>

      <section className="settings-card" aria-labelledby="mcp-h">
        <div className="settings-card-head">
          <h2 id="mcp-h">CockroachDB MCP</h2>
          <span className={`status-dot ${mcpConfigured ? 'on' : ''}`}>
            {mcpConfigured ? 'Ready' : 'Optional'}
          </span>
        </div>
        <p className="settings-hint">
          From CockroachDB Cloud → Connect → MCP. Enables schema tools in Agent
          mode.
        </p>
        <label className="label" htmlFor="mcp-snippet">
          Console JSON snippet
        </label>
        <textarea
          id="mcp-snippet"
          className="field area"
          rows={4}
          placeholder='{ "headers": { "mcp-cluster-id": "…", "Authorization": "Bearer …" } }'
          value={mcpSnippet}
          onChange={(e) => setMcpSnippet(e.target.value)}
        />
        <div className="row">
          <button
            type="button"
            className="btn primary"
            disabled={busy || !mcpSnippet.trim()}
            onClick={saveMcpSnippet}
          >
            Save snippet
          </button>
        </div>

        <p className="settings-or">or enter manually</p>
        <label className="label" htmlFor="cluster-id">
          Cluster ID
        </label>
        <input
          id="cluster-id"
          className="field"
          autoComplete="off"
          spellCheck={false}
          value={clusterId}
          onChange={(e) => setClusterId(e.target.value)}
        />
        <label className="label" htmlFor="mcp-key">
          MCP API key
        </label>
        <input
          id="mcp-key"
          className="field"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={mcpConfigured ? '•••••••• (replace)' : 'Paste key'}
          value={mcpApiKey}
          onChange={(e) => setMcpApiKey(e.target.value)}
        />
        <label className="label" htmlFor="ccloud-key">
          ccloud API key{' '}
          <span className="optional">
            {ccloudConfigured ? '(set)' : '(optional)'}
          </span>
        </label>
        <input
          id="ccloud-key"
          className="field"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={ccloudKey}
          onChange={(e) => setCcloudKey(e.target.value)}
        />
        <div className="row">
          <button
            type="button"
            className="btn primary"
            disabled={busy || !clusterId.trim() || !mcpApiKey.trim()}
            onClick={saveMcpManual}
          >
            Save
          </button>
          {mcpConfigured || ccloudConfigured ? (
            <button
              type="button"
              className="btn ghost"
              disabled={busy}
              onClick={clearMcp}
            >
              Clear Cockroach
            </button>
          ) : null}
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">MCP servers</h2>
        <p className="hint">
          From <code>.walkcroach/mcp.json</code> in this workspace. Servers that
          run a local program are off unless{' '}
          <code>walkcroach.ide.mcp.allowStdio</code> is enabled in your{' '}
          <strong>user</strong> settings — a workspace cannot turn it on for you.
        </p>
        {mcpServers.length === 0 ? (
          <p className="hint">No MCP servers are configured in this workspace.</p>
        ) : (
          <ul className="mcp-list">
            {mcpServers.map((s) => (
              <li key={s.name} className="mcp-row">
                <div className="mcp-row-head">
                  <span className="mcp-name">{s.name}</span>
                  <span className="pill">{s.transport}</span>
                  {s.running ? <span className="pill on">running</span> : null}
                  {s.transport === 'stdio' && s.approved ? (
                    <span className="pill on">approved</span>
                  ) : null}
                </div>
                {/* The resolved absolute command, not what mcp.json wrote — the
                    difference is the whole point of showing it. */}
                <code className="mcp-detail">{s.detail}</code>
                {s.pid ? <span className="hint">pid {s.pid}</span> : null}
                {s.blockedReason ? (
                  <p className="hint">{s.blockedReason}</p>
                ) : null}
                {s.transport === 'stdio' ? (
                  <div className="row">
                    {s.running ? (
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={() =>
                          getVsCodeApi().postMessage({
                            type: 'STOP_MCP_SERVER',
                            name: s.name,
                          })
                        }
                      >
                        Stop
                      </button>
                    ) : null}
                    {s.approved ? (
                      <button
                        type="button"
                        className="btn ghost"
                        title="You will be asked again on the next run"
                        onClick={() =>
                          getVsCodeApi().postMessage({
                            type: 'REVOKE_MCP_CONSENT',
                            name: s.name,
                          })
                        }
                      >
                        Revoke approval
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {mcpStdioAllowed && mcpServers.some((s) => s.approved) ? (
          <button
            type="button"
            className="btn ghost"
            onClick={() => getVsCodeApi().postMessage({ type: 'REVOKE_MCP_CONSENT' })}
          >
            Revoke all approvals
          </button>
        ) : null}
      </section>

      <button type="button" className="btn primary wide" onClick={onBack}>
        Done — back to chat
      </button>
    </div>
  );
}
