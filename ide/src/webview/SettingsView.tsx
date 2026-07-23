import { useState, useCallback } from 'react';
import { getVsCodeApi } from './vscodeApi';

type Props = {
  bedrockConfigured: boolean;
  mcpConfigured: boolean;
  ccloudConfigured: boolean;
  onBack: () => void;
};

/**
 * Credentials page — secrets go to the host SecretStorage only.
 * Never echo stored values back into the webview (industry standard).
 */
export function SettingsView({
  bedrockConfigured,
  mcpConfigured,
  ccloudConfigured,
  onBack,
}: Props) {
  const [bedrockKey, setBedrockKey] = useState('');
  const [mcpSnippet, setMcpSnippet] = useState('');
  const [clusterId, setClusterId] = useState('');
  const [mcpApiKey, setMcpApiKey] = useState('');
  const [ccloudKey, setCcloudKey] = useState('');
  const [busy, setBusy] = useState(false);

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
          to this IDE process.
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

      <button type="button" className="btn primary wide" onClick={onBack}>
        Done — back to chat
      </button>
    </div>
  );
}
