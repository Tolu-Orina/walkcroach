import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createDeviceSession,
  createWorkspace,
  deleteCapture,
  deleteWorkspace,
  fetchHealth,
  linkWorkspaceProject,
  listCaptures,
  listMyProjects,
  listWorkspaces,
  PRIVACY_URL,
  saveCapture,
  streamAsk,
  streamDraft,
  streamPropose,
  streamRecall,
  streamSummarize,
  trackPrice,
  type AgentEvent,
  type Capture,
  type WebProject,
  type Workspace,
} from '../../lib/api';
import {
  ensureDeviceSession,
  upgradeToCognito,
  type StoredSession,
} from '../../lib/auth';
import type { PageExtract } from '../../lib/extract';
import {
  ensureOriginPermission,
  listGrantedOrigins,
  revokeOrigin,
} from '../../lib/permissions';
import {
  matchSiteProfile,
  type SiteProfile,
} from '../../lib/site-profiles/matcher';
import './style.css';

type TabId = 'page' | 'recall' | 'workspaces' | 'trust';

function withWebAvailability(base: string, available?: boolean): string {
  if (!available) return base;
  return `${base} Also available in your WalkCroach project.`;
}

export function App() {
  const [tab, setTab] = useState<TabId>('page');
  const [session, setSession] = useState<StoredSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [extract, setExtract] = useState<PageExtract | null>(null);
  const [streamText, setStreamText] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [question, setQuestion] = useState('');
  const [recallQ, setRecallQ] = useState('');
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWs, setActiveWs] = useState<string>('');
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [newWsName, setNewWsName] = useState('');
  const [origins, setOrigins] = useState<string[]>([]);
  const [draftIntent, setDraftIntent] = useState(false);
  const [profile, setProfile] = useState<SiteProfile | null>(null);
  const [proposalFields, setProposalFields] = useState<Record<
    string,
    string
  > | null>(null);
  const [proposalMeta, setProposalMeta] = useState<{
    captureType: string;
    actionId: string;
  } | null>(null);
  const [priceHistory, setPriceHistory] = useState<
    Array<{ price: number; currency: string; at: string }> | null
  >(null);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [webProjects, setWebProjects] = useState<WebProject[]>([]);
  const streamAbortRef = useRef<AbortController | null>(null);

  const beginStream = useCallback(() => {
    streamAbortRef.current?.abort();
    const ac = new AbortController();
    streamAbortRef.current = ac;
    return ac.signal;
  }, []);

  useEffect(() => {
    return () => {
      streamAbortRef.current?.abort();
    };
  }, []);
  const [linkHint, setLinkHint] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);

  const token = session?.accessToken ?? '';

  const refreshWebProjects = useCallback(async (tok: string, source: string) => {
    if (source !== 'cognito') {
      setWebProjects([]);
      setLinkHint('Sign in on the Trust tab to link a WalkCroach Web project.');
      return;
    }
    try {
      const data = await listMyProjects(tok);
      setWebProjects(data.projects);
      setLinkHint(data.hint ?? null);
    } catch {
      setWebProjects([]);
      setLinkHint('Could not load Web projects.');
    }
  }, []);

  const bootstrap = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await fetchHealth();
      const s = await ensureDeviceSession(createDeviceSession);
      setSession(s);
      const ws = await listWorkspaces(s.accessToken);
      setWorkspaces(ws);
      if (ws[0]) setActiveWs(ws[0].id);
      await refreshWebProjects(s.accessToken, s.source);
      const draft = await chrome.storage.session.get('wc_draft_intent');
      if (draft.wc_draft_intent) {
        setDraftIntent(true);
        setTab('page');
        await chrome.storage.session.remove('wc_draft_intent');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'bootstrap failed');
    } finally {
      setLoading(false);
    }
  }, [refreshWebProjects]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const loadExtract = useCallback(async () => {
    const res = (await chrome.runtime.sendMessage({
      type: 'GET_ACTIVE_EXTRACT',
    })) as { ok?: boolean; extract?: PageExtract };
    if (res?.ok && res.extract) {
      setExtract(res.extract);
      setProfile(matchSiteProfile(res.extract.url));
      return res.extract;
    }
    setError('Could not read this page. Try refreshing, then open WalkCroach again.');
    return null;
  }, []);

  /** Permission before extract (JIT host) — fixes first-run chicken-and-egg. */
  const preparePage = useCallback(async (): Promise<PageExtract | null> => {
    if (extract) {
      const granted = await ensureOriginPermission(extract.url);
      if (!granted) {
        setError('Site access is required for this action.');
        return null;
      }
      return extract;
    }
    const meta = (await chrome.runtime.sendMessage({
      type: 'GET_ACTIVE_TAB_INFO',
    })) as { ok?: boolean; url?: string; title?: string };
    if (!meta?.ok || !meta.url) {
      setError('Could not read the active tab.');
      return null;
    }
    if (
      meta.url.startsWith('chrome://') ||
      meta.url.startsWith('chrome-extension://') ||
      meta.url.startsWith('about:')
    ) {
      setError('This page cannot be read by extensions.');
      return null;
    }
    setProfile(matchSiteProfile(meta.url));
    const granted = await ensureOriginPermission(meta.url);
    if (!granted) {
      setError('Site access is required for this action.');
      return null;
    }
    return loadExtract();
  }, [extract, loadExtract]);

  useEffect(() => {
    // Detect sector from active tab URL without uploading page content.
    void chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => {
      if (t?.url) setProfile(matchSiteProfile(t.url));
    });
  }, []);

  const ensureNamedWorkspace = async (name: string): Promise<string> => {
    const existing = workspaces.find(
      (w) => w.name.toLowerCase() === name.toLowerCase(),
    );
    if (existing) {
      setActiveWs(existing.id);
      return existing.id;
    }
    const ws = await createWorkspace(token, name);
    setWorkspaces((w) => [ws, ...w]);
    setActiveWs(ws.id);
    return ws.id;
  };

  const runStream = useCallback(
    async (gen: AsyncGenerator<AgentEvent>) => {
      setStreaming(true);
      setStreamText('');
      setError(null);
      try {
        for await (const ev of gen) {
          if (ev.type === 'token') {
            setStreamText((t) => t + ev.text);
          } else if (ev.type === 'error') {
            setError(ev.message);
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'stream failed');
      } finally {
        setStreaming(false);
      }
    },
    [],
  );

  const onSummarize = async () => {
    if (!token) return;
    const page = await preparePage();
    if (!page) return;
    // Cache: skip re-call if same hash in session
    const cacheKey = `sum:${page.contentHash}`;
    const cached = await chrome.storage.session.get(cacheKey);
    if (typeof cached[cacheKey] === 'string') {
      setStreamText(cached[cacheKey] as string);
      return;
    }
    let full = '';
    setStreaming(true);
    setStreamText('');
    setError(null);
    const signal = beginStream();
    try {
      for await (const ev of streamSummarize(token, page, signal)) {
        if (ev.type === 'token') {
          full += ev.text;
          setStreamText(full);
        } else if (ev.type === 'error') {
          setError(ev.message);
        }
      }
      if (full && !signal.aborted) await chrome.storage.session.set({ [cacheKey]: full });
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setError(err instanceof Error ? err.message : 'summarize failed');
      }
    } finally {
      setStreaming(false);
    }
  };

  const onAsk = async () => {
    if (!token || !question.trim()) return;
    const page = await preparePage();
    if (!page) return;
    await runStream(
      streamAsk(token, { ...page, question: question.trim() }, beginStream()),
    );
  };

  const onDraft = async () => {
    if (!token) return;
    const page = await preparePage();
    if (!page) return;
    const matched = profile ?? matchSiteProfile(page.url);
    const tone =
      matched?.draftTone ??
      (matched?.sector === 'support'
        ? 'warm, clear, customer-support'
        : 'professional, plain language');
    await runStream(
      streamDraft(
        token,
        {
          ...page,
          workspaceId: activeWs || null,
          instruction: draftIntent || matched?.actionId === 'draft_support'
            ? 'Draft a reply suitable for the focused compose field.'
            : 'Draft helpful copy based on this page.',
          tone,
        },
        beginStream(),
      ),
    );
  };

  const onSectorAction = async () => {
    if (!token || !profile) return;
    const page = await preparePage();
    if (!page) return;

    const wsId = await ensureNamedWorkspace(profile.defaultWorkspace);
    setProposalFields(null);
    setProposalMeta(null);
    setPriceHistory(null);
    setSaveNote(null);

    if (profile.actionId === 'track_price') {
      setStreaming(true);
      setError(null);
      try {
        // First get structured proposal for price fields, then upsert
        let fields: Record<string, unknown> | null = null;
        for await (const ev of streamPropose(
          token,
          {
            ...page,
            actionId: profile.actionId,
            captureType: profile.captureType,
            fields: profile.fields,
            label: profile.label,
          },
          beginStream(),
        )) {
          if (ev.type === 'token') {
            setStreamText((t) => t + ev.text);
          } else if (ev.type === 'proposal') {
            fields = ev.fields;
            setProposalFields(
              Object.fromEntries(
                Object.entries(ev.fields).map(([k, v]) => [k, String(v ?? '')]),
              ),
            );
            setProposalMeta({
              captureType: ev.captureType,
              actionId: ev.actionId,
            });
          } else if (ev.type === 'error') {
            setError(ev.message);
          }
        }
        if (!fields) return;
        const result = await trackPrice(token, {
          workspaceId: wsId,
          url: page.url,
          title: page.title,
          extractedText: page.extractedText,
          contentHash: page.contentHash,
          structuredFields: fields,
          price: fields.price as string | number | undefined,
          currency: fields.currency as string | undefined,
          productName: fields.productName as string | undefined,
        });
        const hist =
          (
            result.structuredFields as
              | { history?: Array<{ price: number; currency: string; at: string }> }
              | undefined
          )?.history ?? null;
        setPriceHistory(hist);
        setSaveNote(
          withWebAvailability(
            result.appended
              ? `Price history updated in “${profile.defaultWorkspace}”.`
              : `Started tracking in “${profile.defaultWorkspace}”.`,
            result.availableInWebProject,
          ),
        );
        await refreshCaptures(wsId, token);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'price track failed');
      } finally {
        setStreaming(false);
      }
      return;
    }

    if (profile.actionId === 'draft_support') {
      await runStream(
        streamDraft(
          token,
          {
            ...page,
            workspaceId: wsId,
            instruction:
              'Draft a clear customer-support reply for the focused compose field.',
            tone: profile.draftTone ?? 'warm, clear, customer-support',
          },
          beginStream(),
        ),
      );
      return;
    }

    // Structured extract (candidate / lead / listing)
    setStreaming(true);
    setStreamText('');
    setError(null);
    try {
      for await (const ev of streamPropose(
        token,
        {
          ...page,
          actionId: profile.actionId,
          captureType: profile.captureType,
          fields: profile.fields,
          label: profile.label,
        },
        beginStream(),
      )) {
        if (ev.type === 'token') {
          setStreamText((t) => t + ev.text);
        } else if (ev.type === 'proposal') {
          setProposalFields(
            Object.fromEntries(
              Object.entries(ev.fields).map(([k, v]) => [k, String(v ?? '')]),
            ),
          );
          setProposalMeta({
            captureType: ev.captureType,
            actionId: ev.actionId,
          });
          setStreamText(ev.summary);
        } else if (ev.type === 'error') {
          setError(ev.message);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'propose failed');
    } finally {
      setStreaming(false);
    }
  };

  const onAcceptProposal = async () => {
    if (!token || !proposalFields || !proposalMeta) return;
    const page = await preparePage();
    if (!page) return;
    const wsName = profile?.defaultWorkspace ?? 'Saved';
    const wsId = await ensureNamedWorkspace(wsName);
    const summary = Object.entries(proposalFields)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');
    try {
      const saved = await saveCapture(token, {
        workspaceId: wsId,
        url: page.url,
        title: page.title,
        extractedText: summary || page.extractedText,
        contentHash: page.contentHash,
        captureType: proposalMeta.captureType,
        structuredFields: proposalFields,
      });
      setSaveNote(
        withWebAvailability(
          `Saved to “${wsName}”. Review fields above were stored.`,
          saved.availableInWebProject,
        ),
      );
      setProposalFields(null);
      await refreshCaptures(wsId, token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'save proposal failed');
    }
  };

  const onRecall = async () => {
    if (!token || !recallQ.trim()) return;
    await runStream(
      streamRecall(
        token,
        {
          question: recallQ.trim(),
          workspaceId: activeWs || null,
          scope: activeWs ? 'workspace' : 'all',
        },
        beginStream(),
      ),
    );
  };

  const refreshCaptures = async (wsId: string, tok: string) => {
    const caps = await listCaptures(tok, wsId);
    setCaptures(caps);
  };

  useEffect(() => {
    if (!token || !activeWs) {
      setCaptures([]);
      return;
    }
    void refreshCaptures(activeWs, token).catch((err) =>
      setError(err instanceof Error ? err.message : 'list captures failed'),
    );
  }, [token, activeWs]);

  const onSave = async () => {
    if (!token || !activeWs) {
      setError('Create or select a workspace first.');
      setTab('workspaces');
      return;
    }
    const page = await preparePage();
    if (!page) return;
    try {
      const saved = await saveCapture(token, {
        workspaceId: activeWs,
        url: page.url,
        title: page.title,
        extractedText: page.extractedText,
        contentHash: page.contentHash,
      });
      await refreshCaptures(activeWs, token);
      setSaveNote(
        withWebAvailability('Page saved.', saved.availableInWebProject),
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'save failed');
    }
  };

  const onLinkProject = async (projectId: string) => {
    if (!token || !activeWs) return;
    setLinking(true);
    setError(null);
    try {
      const result = await linkWorkspaceProject(
        token,
        activeWs,
        projectId || null,
      );
      const ws = await listWorkspaces(token);
      setWorkspaces(ws);
      setSaveNote(
        result.message ??
          (result.linkedProjectId
            ? 'Also available in your WalkCroach project.'
            : 'Unlinked from Web project.'),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'link failed');
    } finally {
      setLinking(false);
    }
  };

  const onCreateWs = async () => {
    if (!token || !newWsName.trim()) return;
    try {
      const ws = await createWorkspace(token, newWsName.trim());
      setWorkspaces((w) => [ws, ...w]);
      setActiveWs(ws.id);
      setNewWsName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'create workspace failed');
    }
  };

  const refreshOrigins = async () => {
    setOrigins(await listGrantedOrigins());
  };

  useEffect(() => {
    if (tab === 'trust') void refreshOrigins();
  }, [tab]);

  const activeWsName = useMemo(
    () => workspaces.find((w) => w.id === activeWs)?.name ?? '',
    [workspaces, activeWs],
  );
  const activeLinkedProjectId = useMemo(
    () =>
      workspaces.find((w) => w.id === activeWs)?.linked_project_id ?? null,
    [workspaces, activeWs],
  );
  const linkedProjectName = useMemo(() => {
    if (!activeLinkedProjectId) return null;
    return (
      webProjects.find((p) => p.id === activeLinkedProjectId)?.name ?? null
    );
  }, [webProjects, activeLinkedProjectId]);

  return (
    <div className="shell">
      <header>
        <h1>WalkCroach</h1>
        <p className="tagline">Summarize, draft, and remember.</p>
      </header>

      <nav className="tabs">
        {(
          [
            ['page', 'Page'],
            ['recall', 'Recall'],
            ['workspaces', 'Workspaces'],
            ['trust', 'Trust'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={tab === id ? 'active' : ''}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {loading && <p className="status">Connecting…</p>}
      {error && (
        <p className="error">
          {error}{' '}
          <button type="button" className="link" onClick={() => setError(null)}>
            dismiss
          </button>
        </p>
      )}

      {!loading && session && tab === 'page' && (
        <section className="panel">
          <p className="muted">
            {extract
              ? `${extract.title || 'Page'} · ${extract.extractedText.length} chars`
              : 'Page text is read only when you click an action.'}
          </p>
          {profile && (
            <p className="sector-chip">
              {profile.sector.replace('_', ' ')} · {profile.label}
            </p>
          )}
          <div className="actions">
            {profile && (
              <button
                type="button"
                className="primary-sector"
                disabled={streaming}
                onClick={() => void onSectorAction()}
              >
                {profile.label}
              </button>
            )}
            <button type="button" disabled={streaming} onClick={() => void onSummarize()}>
              Summarize
            </button>
            <button type="button" disabled={streaming} onClick={() => void onDraft()}>
              Draft
            </button>
            <button type="button" disabled={streaming} onClick={() => void onSave()}>
              Save{activeWsName ? ` → ${activeWsName}` : ''}
            </button>
          </div>
          <div className="ask-row">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask about this page…"
            />
            <button type="button" disabled={streaming || !question.trim()} onClick={() => void onAsk()}>
              Ask
            </button>
          </div>
          {proposalFields && (
            <div className="proposal">
              <h2>Review before saving</h2>
              {Object.entries(proposalFields).map(([key, value]) => (
                <label key={key} className="field">
                  <span>{key}</span>
                  <input
                    value={value}
                    onChange={(e) =>
                      setProposalFields((prev) =>
                        prev ? { ...prev, [key]: e.target.value } : prev,
                      )
                    }
                  />
                </label>
              ))}
              <div className="actions">
                <button type="button" onClick={() => void onAcceptProposal()}>
                  Accept & save
                </button>
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    setProposalFields(null);
                    setProposalMeta(null);
                  }}
                >
                  Discard
                </button>
              </div>
            </div>
          )}
          {priceHistory && priceHistory.length > 0 && (
            <div className="proposal">
              <h2>Price history</h2>
              <ul className="list">
                {[...priceHistory].reverse().map((h, i) => (
                  <li key={`${h.at}-${i}`}>
                    <span>
                      {h.currency} {h.price}
                    </span>
                    <span className="muted small">
                      {new Date(h.at).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {saveNote && <p className="save-note">{saveNote}</p>}
          {(streamText || streaming) && !proposalFields && (
            <div className="stream">
              {streamText || (streaming ? '…' : '')}
              {streamText && !streaming && (
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    void chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => {
                      if (t?.id) {
                        void chrome.tabs.sendMessage(t.id, {
                          type: 'INSERT_DRAFT',
                          payload: { text: streamText },
                        });
                      }
                    });
                  }}
                >
                  Insert into page
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {!loading && session && tab === 'recall' && (
        <section className="panel">
          <p className="muted">
            Search your saved captures
            {activeWsName ? ` in “${activeWsName}”` : ' across all workspaces'}.
          </p>
          <div className="ask-row">
            <input
              value={recallQ}
              onChange={(e) => setRecallQ(e.target.value)}
              placeholder="What did I save about…"
            />
            <button type="button" disabled={streaming || !recallQ.trim()} onClick={() => void onRecall()}>
              Recall
            </button>
          </div>
          {(streamText || streaming) && (
            <div className="stream">{streamText || '…'}</div>
          )}
        </section>
      )}

      {!loading && session && tab === 'workspaces' && (
        <section className="panel">
          <div className="ask-row">
            <input
              value={newWsName}
              onChange={(e) => setNewWsName(e.target.value)}
              placeholder="New workspace name"
            />
            <button type="button" onClick={() => void onCreateWs()}>
              Create
            </button>
          </div>
          <ul className="list">
            {workspaces.map((w) => (
              <li key={w.id} className={w.id === activeWs ? 'selected' : ''}>
                <button type="button" className="link" onClick={() => setActiveWs(w.id)}>
                  {w.name}
                  {w.linked_project_id ? ' · linked' : ''}
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() =>
                    void deleteWorkspace(token, w.id)
                      .then(async () => {
                        const next = await listWorkspaces(token);
                        setWorkspaces(next);
                        setActiveWs(next[0]?.id ?? '');
                      })
                      .catch((err) =>
                        setError(
                          err instanceof Error
                            ? err.message
                            : 'delete workspace failed',
                        ),
                      )
                  }
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
          {activeWs && (
            <>
              <h2>Link to Web project</h2>
              {session.source !== 'cognito' ? (
                <p className="muted small">
                  {linkHint ??
                    'Sign in on the Trust tab to link a WalkCroach Web project.'}
                </p>
              ) : (
                <>
                  <div className="ask-row">
                    <select
                      value={activeLinkedProjectId ?? ''}
                      disabled={linking}
                      onChange={(e) => void onLinkProject(e.target.value)}
                    >
                      <option value="">Not linked</option>
                      {webProjects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  {linkedProjectName && (
                    <p className="save-note">
                      Also available in your WalkCroach project “
                      {linkedProjectName}”.
                    </p>
                  )}
                  {!webProjects.length && (
                    <p className="muted small">
                      No Web projects yet. Create one in WalkCroach Web, then
                      refresh.
                    </p>
                  )}
                </>
              )}
              <h2>Saved in {activeWsName}</h2>
              <ul className="list">
                {captures.map((c) => (
                  <li key={c.id}>
                    <div>
                      <strong>{c.title || c.url}</strong>
                      <div className="muted small">{c.url}</div>
                      {c.capture_type === 'price' &&
                        typeof c.structured_fields === 'object' &&
                        c.structured_fields &&
                        'history' in (c.structured_fields as object) && (
                          <div className="muted small">
                            Price track ·{' '}
                            {
                              (
                                (c.structured_fields as {
                                  history: unknown[];
                                }).history ?? []
                              ).length
                            }{' '}
                            points
                          </div>
                        )}
                    </div>
                    <button
                      type="button"
                      className="danger"
                      onClick={() =>
                        void deleteCapture(token, c.id)
                          .then(() => refreshCaptures(activeWs, token))
                          .catch((err) =>
                            setError(
                              err instanceof Error
                                ? err.message
                                : 'delete capture failed',
                            ),
                          )
                      }
                    >
                      Delete
                    </button>
                  </li>
                ))}
                {!captures.length && <li className="muted">No captures yet.</li>}
              </ul>
            </>
          )}
        </section>
      )}

      {!loading && tab === 'trust' && (
        <section className="panel">
          <p className="muted">
            WalkCroach only requests site access when you summarize or save. Nothing
            is uploaded just by opening this panel.
          </p>
          <p className="small">
            <a href={PRIVACY_URL} target="_blank" rel="noreferrer">
              Privacy policy
            </a>
          </p>
          <p className="small">
            Session: {session?.ownerId ?? '—'} ({session?.source ?? 'device'})
          </p>
          {session?.source === 'device' && (
            <div className="ask-row">
              <input
                id="cognito-token"
                placeholder="Paste Cognito access token to link account"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const v = (e.target as HTMLInputElement).value.trim();
                    if (!v) return;
                    void upgradeToCognito(v)
                      .then(async (s) => {
                        setSession(s);
                        setError(null);
                        (e.target as HTMLInputElement).value = '';
                        const ws = await listWorkspaces(s.accessToken);
                        setWorkspaces(ws);
                        await refreshWebProjects(s.accessToken, s.source);
                      })
                      .catch((err) =>
                        setError(
                          err instanceof Error ? err.message : 'upgrade failed',
                        ),
                      );
                  }
                }}
              />
            </div>
          )}
          <button type="button" onClick={() => void refreshOrigins()}>
            Refresh access list
          </button>
          <ul className="list">
            {origins.map((o) => (
              <li key={o}>
                <span>{o}</span>
                <button
                  type="button"
                  className="danger"
                  onClick={() =>
                    void revokeOrigin(o).then(() => refreshOrigins())
                  }
                >
                  Revoke
                </button>
              </li>
            ))}
            {!origins.length && (
              <li className="muted">No site access granted yet.</li>
            )}
          </ul>
          <button
            type="button"
            className="link"
            onClick={() =>
              void ensureDeviceSession(createDeviceSession)
                .then((s) => {
                  setSession(s);
                  setError(null);
                })
                .catch((err) =>
                  setError(
                    err instanceof Error ? err.message : 'session refresh failed',
                  ),
                )
            }
          >
            Refresh session
          </button>
        </section>
      )}
    </div>
  );
}
