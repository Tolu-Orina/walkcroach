import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createDeviceSession,
  createWorkspace,
  deleteCapture,
  deleteWorkspace,
  fetchCredits,
  fetchHealth,
  linkWorkspaceProject,
  listCaptures,
  listMyProjects,
  listWorkspaces,
  PRIVACY_URL,
  saveCapture,
  uploadScreenshot,
  declineConnectorRun,
  disconnectConnector,
  executeConnectorRun,
  listConnectors,
  createChatHandoff,
  streamAsk,
  streamDraft,
  streamPropose,
  streamRecall,
  streamSummarize,
  trackPrice,
  WEB_APP_URL,
  type AgentEvent,
  type Capture,
  type RecallSource,
  type ConnectorProposal,
  type ConnectorsResponse,
  type CreditBalance,
  type WebProject,
  type Workspace,
} from '../../lib/api';
import {
  ensureDeviceSession,
  signOutToDevice,
  startWebSignIn,
  upgradeToCognito,
  type StoredSession,
} from '../../lib/auth';
import type { PageExtract } from '../../lib/extract';
import { formatNetworkError } from '../../lib/errors';
import {
  listGrantedOrigins,
  originLabel,
  requestOriginPermission,
  revokeOrigin,
} from '../../lib/permissions';
import { describePageAccess, type PageAccess } from '../../lib/page-access';
import type { PendingSelection } from '../../lib/selection';
import {
  isWithinUploadLimit,
  base64FromDataUrl,
  type CapturedScreenshot,
} from '../../lib/screenshot';
import {
  matchSiteProfile,
  type SiteProfile,
} from '../../lib/site-profiles/matcher';
import { initProfiles } from '../../lib/site-profiles/remote';
import { BrandHeader } from './components/BrandHeader';
import { ContextHeader } from './components/ContextHeader';
import { AccessNotice } from './components/AccessNotice';
import { PrimaryActions } from './components/PrimaryActions';
import { Stream } from './components/Stream';
import { ConfirmCard, type ConfirmSummaryRow } from './components/ConfirmCard';
import { PriceHistory, type PricePoint } from './components/PriceHistory';
import { Composer } from './components/Composer';
import { NavRail, type TabId } from './components/NavRail';
import { CoachMark, useCoachMark } from './components/CoachMark';
import { CreditMeter } from './components/CreditMeter';
import { RecallSources } from './components/RecallSources';
import { ConnectorsPanel } from './components/ConnectorsPanel';
import { SitesPanel } from './components/SitesPanel';
import { EmptyState } from './components/EmptyState';
import './style.css';

/** First ~180 characters, so the confirm card shows what was highlighted. */
function preview(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > 180 ? `${one.slice(0, 180).trimEnd()}…` : one;
}

/**
 * Stable non-crypto digest of a highlight, in the same FNV form the page
 * extractor emits so both kinds of content hash look alike in the database.
 * Prefixed so a selection can never collide with the page it came from.
 */
export function hashSelection(selection: {
  url: string;
  text: string;
}): string {
  const seed = `${selection.url}\n${selection.text}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return `sel:fnv:${hash.toString(16)}`;
}

function withWebAvailability(base: string, available?: boolean): string {
  if (!available) return base;
  return `${base} Also available in your WalkCroach project.`;
}

/**
 * A write the user has been shown but has not yet approved (Phase C4).
 *
 * Nothing in this panel reaches CockroachDB without passing through here first.
 * `track_price` and plain Save both used to commit the moment their data
 * arrived; routing them through a pending state is what makes
 * propose → confirm → execute true rather than aspirational.
 */
type PendingWrite =
  | { kind: 'capture'; page: PageExtract; workspaceId: string; workspaceName: string }
  | {
      kind: 'proposal';
      page: PageExtract;
      workspaceId: string;
      workspaceName: string;
      captureType: string;
      actionId: string;
    }
  | {
      kind: 'price';
      page: PageExtract;
      workspaceId: string;
      workspaceName: string;
      rawFields: Record<string, unknown>;
    }
  /** A highlight sent from the context menu — only the selected words. */
  | {
      kind: 'selection';
      selection: PendingSelection;
      workspaceId: string;
      workspaceName: string;
    }
  /**
   * A connector action the BFF has already validated and recorded as `proposed`
   * (Phase E4). The panel holds only the run id — the payload lives server-side,
   * so confirming cannot substitute different arguments.
   */
  | { kind: 'connector'; proposal: ConnectorProposal };

export function App() {
  const [tab, setTab] = useState<TabId>('page');
  const [session, setSession] = useState<StoredSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [extract, setExtract] = useState<PageExtract | null>(null);
  const [streamText, setStreamText] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [question, setQuestion] = useState('');
  const [webSearch, setWebSearch] = useState(false);
  const [recallQ, setRecallQ] = useState('');
  const [recallSources, setRecallSources] = useState<RecallSource[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWs, setActiveWs] = useState<string>('');
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [newWsName, setNewWsName] = useState('');
  const [profile, setProfile] = useState<SiteProfile | null>(null);
  const [proposalFields, setProposalFields] = useState<Record<
    string,
    string
  > | null>(null);
  const [pending, setPending] = useState<PendingWrite | null>(null);
  const [committing, setCommitting] = useState(false);
  const [priceHistory, setPriceHistory] = useState<PricePoint[] | null>(null);
  const [priceChanged, setPriceChanged] = useState<boolean | undefined>(undefined);
  /** Opt-in screenshot attached to the pending capture (Phase D4). */
  const [shot, setShot] = useState<CapturedScreenshot | null>(null);
  const [shotBusy, setShotBusy] = useState(false);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [webProjects, setWebProjects] = useState<WebProject[]>([]);
  const [access, setAccess] = useState<PageAccess | null>(null);
  const [grantedOrigins, setGrantedOrigins] = useState<string[]>([]);
  const [credits, setCredits] = useState<CreditBalance | null>(null);
  const [connectors, setConnectors] = useState<ConnectorsResponse | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [connectorResult, setConnectorResult] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [linkHint, setLinkHint] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const streamAbortRef = useRef<AbortController | null>(null);
  /**
   * `claimSelection` needs `ensureNamedWorkspace`, which is declared later and
   * closes over current state. A ref keeps the call site honest without
   * reordering the whole component or recreating the callback per render.
   */
  const ensureNamedWorkspaceRef = useRef<(name: string) => Promise<string>>(
    async () => '',
  );
  const coach = useCoachMark();

  const token = session?.accessToken ?? '';

  const beginStream = useCallback(() => {
    streamAbortRef.current?.abort();
    const ac = new AbortController();
    streamAbortRef.current = ac;
    return ac.signal;
  }, []);

  const cancelStream = useCallback(() => {
    streamAbortRef.current?.abort();
    setStreaming(false);
  }, []);

  useEffect(() => {
    return () => streamAbortRef.current?.abort();
  }, []);

  const refreshWebProjects = useCallback(async (tok: string, source: string) => {
    if (source !== 'cognito') {
      setWebProjects([]);
      setLinkHint('Sign in under Account to link a WalkCroach Web project.');
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
      // Null until the shared ledger endpoint ships — the meter stays hidden.
      setCredits(await fetchCredits(s.accessToken));
      // Connections are account-scoped and shared with Web; a failure here must
      // not break bootstrap, so it degrades to "none listed".
      setConnectors(
        await listConnectors(s.accessToken).catch(() => null),
      );
    } catch (err) {
      setError(formatNetworkError(err, 'bootstrap failed'));
    } finally {
      setLoading(false);
    }
  }, [refreshWebProjects]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // Web connect can finish on auth.html — refresh when the auth source flips.
  useEffect(() => {
    const clearSummarizeCache = async () => {
      const all = await chrome.storage.session.get(null);
      const keys = Object.keys(all).filter((k) => k.startsWith('sum:'));
      if (keys.length) await chrome.storage.session.remove(keys);
    };
    const onChanged: Parameters<
      typeof chrome.storage.onChanged.addListener
    >[0] = (changes, area) => {
      if (area !== 'local') return;
      if (!changes.wc_auth_source) return;
      void clearSummarizeCache().then(() => bootstrap());
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [bootstrap]);

  /* ── Page access ─────────────────────────────────────────────────── */

  const applyAccess = useCallback((next: PageAccess) => {
    setAccess(next);
    setProfile(
      next.status === 'ready' || next.status === 'needs-grant'
        ? matchSiteProfile(next.url)
        : null,
    );
  }, []);

  const refreshAccess = useCallback(async (): Promise<PageAccess | null> => {
    const res = (await chrome.runtime.sendMessage({
      type: 'GET_PAGE_CONTEXT',
    })) as { ok?: boolean; access?: PageAccess };
    if (!res?.access) return null;
    applyAccess(res.access);
    return res.access;
  }, [applyAccess]);

  const refreshGrantedOrigins = useCallback(async () => {
    setGrantedOrigins(await listGrantedOrigins());
  }, []);

  /**
   * The retry button's action. Distinct from `refreshAccess` because it probes
   * the page, which is only permissible behind an explicit click — see
   * RECHECK_PAGE_ACCESS in lib/messaging.ts.
   *
   * `refreshAccess` alone could never clear the "Tab not visible yet" state:
   * it re-runs a classifier whose answer does not change until a grant exists.
   */
  const recheckAccess = useCallback(async (): Promise<PageAccess | null> => {
    const res = (await chrome.runtime.sendMessage({
      type: 'RECHECK_PAGE_ACCESS',
    })) as { ok?: boolean; access?: PageAccess };
    if (!res?.access) return null;
    applyAccess(res.access);
    await refreshGrantedOrigins();
    return res.access;
  }, [applyAccess, refreshGrantedOrigins]);

  useEffect(() => {
    void chrome.runtime
      .sendMessage({ type: 'WARM_PAGE_CONTEXT' })
      .then((res: { access?: PageAccess }) => {
        if (res?.access) applyAccess(res.access);
      })
      .catch(() => undefined);
    void refreshGrantedOrigins();
    // Applies a cached signed bundle if one is newer, then refreshes in the
    // background. Never awaited — profiles must not gate first paint, and any
    // failure leaves the packaged bundle in force.
    void initProfiles().catch(() => undefined);
  }, [applyAccess, refreshGrantedOrigins]);

  /**
   * Tell the worker this panel is open, so a second toolbar click closes it.
   * The heartbeat keeps the worker alive while mounted, which is what makes its
   * `onDisconnect` fire reliably on close.
   */
  useEffect(() => {
    let port: chrome.runtime.Port | null = null;
    let beat: ReturnType<typeof setInterval> | null = null;

    void chrome.windows.getCurrent().then((win) => {
      if (typeof win.id !== 'number') return;
      port = chrome.runtime.connect({ name: 'walkcroach-panel' });
      port.postMessage({ windowId: win.id });
      beat = setInterval(() => {
        try {
          port?.postMessage({ windowId: win.id });
        } catch {
          // Worker cycled; the next mount re-registers.
        }
      }, 20_000);
    });

    return () => {
      if (beat) clearInterval(beat);
      port?.disconnect();
    };
  }, []);

  /**
   * Pick up a highlight queued by the "Save selection" context menu.
   *
   * Runs on mount and on window focus, because the menu can be used while the
   * panel is already open — in which case there is no mount to hook.
   */
  const claimSelection = useCallback(async () => {
    const res = (await chrome.runtime.sendMessage({
      type: 'TAKE_PENDING_SELECTION',
    })) as { ok?: boolean; selection?: PendingSelection | null };
    const selection = res?.selection;
    if (!selection?.text) return;

    const wsName = workspaces.find((w) => w.id === activeWs)?.name ?? 'Saved';
    const wsId = activeWs || (await ensureNamedWorkspaceRef.current(wsName));
    setTab('page');
    setStreamText('');
    setPriceHistory(null);
    setPriceChanged(undefined);
    setSaveNote(null);
    setProposalFields(null);
    setPending({
      kind: 'selection',
      selection,
      workspaceId: wsId,
      workspaceName: wsName,
    });
  }, [activeWs, workspaces]);

  useEffect(() => {
    void claimSelection().catch(() => undefined);
    const onFocus = () => void claimSelection().catch(() => undefined);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [claimSelection]);

  // Keep the context header honest as the user browses with the panel open.
  useEffect(() => {
    const onTabChange = () => {
      setExtract(null);
      setPending(null);
      void refreshAccess();
    };
    const onUpdated = (
      _tabId: number,
      changeInfo: chrome.tabs.TabChangeInfo,
    ) => {
      if (changeInfo.url || changeInfo.status === 'complete') onTabChange();
    };
    chrome.tabs.onActivated.addListener(onTabChange);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.tabs.onActivated.removeListener(onTabChange);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, [refreshAccess]);

  useEffect(() => {
    const onPermissionChange = () => {
      void refreshGrantedOrigins();
      void refreshAccess();
    };
    chrome.permissions.onAdded.addListener(onPermissionChange);
    chrome.permissions.onRemoved.addListener(onPermissionChange);
    return () => {
      chrome.permissions.onAdded.removeListener(onPermissionChange);
      chrome.permissions.onRemoved.removeListener(onPermissionChange);
    };
  }, [refreshAccess, refreshGrantedOrigins]);

  /**
   * Grant-aware page read. MUST be the first `await` chain in a click handler:
   * `permissions.request` only counts while Chrome still sees a live user
   * gesture, and the panel is the only context that can produce one.
   */
  const preparePage = useCallback(async (): Promise<PageExtract | null> => {
    let current = access;

    if (current?.status === 'needs-grant') {
      const ok = await requestOriginPermission(current.origin);
      if (!ok) {
        setError(
          `WalkCroach needs your OK on ${originLabel(
            current.origin,
          )} to do that. Nothing was sent.`,
        );
        return null;
      }
      current = { ...current, status: 'ready' };
      applyAccess(current);
      void refreshGrantedOrigins();
    }

    if (current?.status === 'restricted') {
      setError(describePageAccess(current).message);
      return null;
    }

    const res = (await chrome.runtime.sendMessage({
      type: 'GET_ACTIVE_EXTRACT',
    })) as { ok?: boolean; extract?: PageExtract; access?: PageAccess };

    if (res?.access) applyAccess(res.access);
    if (res?.ok && res.extract) {
      setExtract(res.extract);
      setProfile(matchSiteProfile(res.extract.url));
      return res.extract;
    }

    setError(
      res?.access
        ? describePageAccess(res.access).message
        : 'Could not read this page. Open a normal http(s) tab and try again.',
    );
    return null;
  }, [access, applyAccess, refreshGrantedOrigins]);

  const onGrantSite = useCallback(async () => {
    if (access?.status !== 'needs-grant') return;
    const ok = await requestOriginPermission(access.origin);
    if (!ok) return;
    applyAccess({ ...access, status: 'ready' });
    void refreshGrantedOrigins();
  }, [access, applyAccess, refreshGrantedOrigins]);

  const refreshConnectors = useCallback(async () => {
    if (!token) return;
    setConnectors(await listConnectors(token).catch(() => null));
  }, [token]);

  const onDisconnectConnector = useCallback(
    async (provider: string) => {
      if (!token) return;
      setDisconnecting(provider);
      setError(null);
      try {
        await disconnectConnector(token, provider);
        await refreshConnectors();
        setSaveNote(`Disconnected. This applies everywhere you use WalkCroach.`);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'could not disconnect');
      } finally {
        setDisconnecting(null);
      }
    },
    [token, refreshConnectors],
  );

  const onRevokeSite = useCallback(
    async (originPattern: string) => {
      await revokeOrigin(originPattern);
      await refreshGrantedOrigins();
      await refreshAccess();
      setExtract(null);
      setPending(null);
    },
    [refreshAccess, refreshGrantedOrigins],
  );

  /* ── Workspaces & captures ───────────────────────────────────────── */

  const refreshCaptures = useCallback(async (wsId: string, tok: string) => {
    setCaptures(await listCaptures(tok, wsId));
  }, []);

  useEffect(() => {
    if (!token || !activeWs) {
      setCaptures([]);
      return;
    }
    void refreshCaptures(activeWs, token).catch((err) =>
      setError(err instanceof Error ? err.message : 'list captures failed'),
    );
  }, [token, activeWs, refreshCaptures]);

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

  /* ── Streaming actions ───────────────────────────────────────────── */

  const runStream = useCallback(async (gen: AsyncGenerator<AgentEvent>) => {
    setStreaming(true);
    setStreamText('');
    setError(null);
    try {
      for await (const ev of gen) {
        if (ev.type === 'token') setStreamText((t) => t + ev.text);
        else if (ev.type === 'recall_sources') setRecallSources(ev.sources);
        else if (ev.type === 'error') setError(ev.message);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'stream failed');
    } finally {
      setStreaming(false);
    }
  }, []);

  const clearResults = () => {
    setRecallSources([]);
    setShot(null);
    setConnectorResult(null);
    setProposalFields(null);
    setPending(null);
    setPriceHistory(null);
    setPriceChanged(undefined);
    setSaveNote(null);
  };

  const onSummarize = async () => {
    if (!token) return;
    const page = await preparePage();
    if (!page) return;
    clearResults();
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
      if (full && !signal.aborted) {
        await chrome.storage.session.set({ [cacheKey]: full });
      }
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
    clearResults();
    await runStream(
      streamAsk(
        token,
        { ...page, question: question.trim(), webSearchEnabled: webSearch },
        beginStream(),
      ),
    );
  };

  const onDraft = async () => {
    if (!token) return;
    const page = await preparePage();
    if (!page) return;
    clearResults();
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
          instruction:
            matched?.actionId === 'draft_support'
              ? 'Draft a reply suitable for the focused compose field.'
              : 'Draft helpful copy based on this page.',
          tone,
        },
        beginStream(),
      ),
    );
  };

  const onOpenInWebChat = async () => {
    if (!token) return;
    if (session?.source !== 'cognito') {
      setError('Sign in under Account to open Web Chat.');
      setTab('account');
      return;
    }
    const page = await preparePage();
    if (!page) return;
    try {
      setError(null);
      const { code } = await createChatHandoff(token, {
        title: page.title,
        url: page.url,
        extractedText: page.extractedText,
        question: question.trim() || undefined,
      });
      const target = new URL('/app/chat', WEB_APP_URL.replace(/\/$/, ''));
      target.searchParams.set('handoff', code);
      if (question.trim()) {
        target.searchParams.set('q', question.trim().slice(0, 400));
      }
      if (webSearch) target.searchParams.set('webSearch', '1');
      await chrome.tabs.create({ url: target.toString() });
      setSaveNote('Opened WalkCroach Web Chat with this page context.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open Web Chat');
    }
  };

  /** Save now *proposes*; the write happens in `onCommit`. */
  const onSave = async () => {
    if (!token) return;
    const page = await preparePage();
    if (!page) return;
    clearResults();
    const wsName = workspaces.find((w) => w.id === activeWs)?.name ?? 'Saved';
    const wsId = activeWs || (await ensureNamedWorkspace(wsName));
    setPending({
      kind: 'capture',
      page,
      workspaceId: wsId,
      workspaceName: wsName,
    });
  };

  const onSectorAction = async () => {
    if (!token || !profile) return;
    const page = await preparePage();
    if (!page) return;
    clearResults();

    const wsId = await ensureNamedWorkspace(profile.defaultWorkspace);

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

    // Both price tracking and structured extraction propose first and write
    // only on confirm. Price used to call trackPrice() the instant the
    // proposal arrived, which was a silent write.
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
          setPending(
            profile.actionId === 'track_price'
              ? {
                  kind: 'price',
                  page,
                  workspaceId: wsId,
                  workspaceName: profile.defaultWorkspace,
                  rawFields: ev.fields,
                }
              : {
                  kind: 'proposal',
                  page,
                  workspaceId: wsId,
                  workspaceName: profile.defaultWorkspace,
                  captureType: ev.captureType,
                  actionId: ev.actionId,
                },
          );
          setStreamText(ev.summary);
        } else if (ev.type === 'error') {
          setError(ev.message);
        }
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setError(err instanceof Error ? err.message : 'propose failed');
      }
    } finally {
      setStreaming(false);
    }
  };

  const onRecall = async () => {
    if (!token || !recallQ.trim()) return;
    setRecallSources([]);
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

  /**
   * Grab the visible viewport for the pending capture (Phase D4).
   *
   * Opt-in per save, never automatic: a screenshot is more revealing than page
   * text — it includes whatever else was on screen — so it is attached only when
   * the user asks for it on the confirm card, and shown back before committing.
   */
  const onCaptureScreenshot = async () => {
    setShotBusy(true);
    setError(null);
    try {
      const res = (await chrome.runtime.sendMessage({
        type: 'CAPTURE_SCREENSHOT',
      })) as {
        ok?: boolean;
        screenshot?: CapturedScreenshot;
        access?: PageAccess;
        error?: string;
      };
      if (!res?.ok || !res.screenshot) {
        setError(
          res?.access && res.access.status !== 'ready'
            ? describePageAccess(res.access).message
            : (res?.error ?? 'Could not capture this tab.'),
        );
        return;
      }
      if (!isWithinUploadLimit(res.screenshot)) {
        setError('That screenshot is too large to store. Try a smaller window.');
        return;
      }
      setShot(res.screenshot);
    } finally {
      setShotBusy(false);
    }
  };

  /* ── The single write path ───────────────────────────────────────── */

  /**
   * Upload the opt-in screenshot once the capture row exists.
   *
   * Deliberately non-fatal: the user already confirmed the capture, and losing an
   * enhancement must not turn a successful save into an error. A failure is
   * surfaced as a note, not thrown.
   */
  const attachShot = async (captureId: string): Promise<void> => {
    if (!shot || !captureId) return;
    const base64 = base64FromDataUrl(shot.dataUrl);
    if (!base64) return;
    const ok = await uploadScreenshot(token, captureId, base64);
    if (!ok) {
      setSaveNote('Saved, but the screenshot could not be stored.');
    }
    setShot(null);
  };

  const onCommit = async () => {
    if (!pending || !token) return;
    setCommitting(true);
    setError(null);
    try {
      // A connector action carries no payload here on purpose: the arguments
      // were fixed and validated when the proposal was recorded, so confirming
      // executes exactly what the card showed and nothing else.
      if (pending.kind === 'connector') {
        const result = await executeConnectorRun(token, pending.proposal.runId);
        setConnectorResult(result);
        setSaveNote(`${pending.proposal.title} — done.`);
        setPending(null);
        setCommitting(false);
        return;
      }

      if (pending.kind === 'price') {
        // Edited values win over the model's originals.
        const merged: Record<string, unknown> = {
          ...pending.rawFields,
          ...(proposalFields ?? {}),
        };
        const result = await trackPrice(token, {
          workspaceId: pending.workspaceId,
          url: pending.page.url,
          title: pending.page.title,
          extractedText: pending.page.extractedText,
          contentHash: pending.page.contentHash,
          structuredFields: merged,
          price: merged.price as string | number | undefined,
          currency: merged.currency as string | undefined,
          productName: merged.productName as string | undefined,
        });
        const hist =
          (result.structuredFields as { history?: PricePoint[] } | undefined)
            ?.history ?? null;
        setPriceHistory(hist);
        setPriceChanged(result.priceChanged);
        setSaveNote(
          withWebAvailability(
            result.appended
              ? `Price history updated in “${pending.workspaceName}”.`
              : `Started tracking in “${pending.workspaceName}”.`,
            result.availableInWebProject,
          ),
        );
      } else if (pending.kind === 'proposal') {
        const summary = Object.entries(proposalFields ?? {})
          .map(([k, v]) => `${k}: ${v}`)
          .join('\n');
        const saved = await saveCapture(token, {
          workspaceId: pending.workspaceId,
          url: pending.page.url,
          title: pending.page.title,
          extractedText: summary || pending.page.extractedText,
          contentHash: pending.page.contentHash,
          captureType: pending.captureType,
          structuredFields: proposalFields ?? {},
        });
        setSaveNote(
          withWebAvailability(
            `Saved to “${pending.workspaceName}”.`,
            saved.availableInWebProject,
          ),
        );
      } else if (pending.kind === 'selection') {
        const { selection } = pending;
        const saved = await saveCapture(token, {
          workspaceId: pending.workspaceId,
          url: selection.url,
          title: selection.title || selection.url,
          extractedText: selection.text,
          // Own hash space: a highlight is not the page it came from, and two
          // different highlights from one page must not collide.
          contentHash: hashSelection(selection),
          captureType: 'selection',
        });
        await attachShot(saved.captureId);
        setSaveNote(
          withWebAvailability(
            `Selection saved to “${pending.workspaceName}”.`,
            saved.availableInWebProject,
          ),
        );
      } else {
        const saved = await saveCapture(token, {
          workspaceId: pending.workspaceId,
          url: pending.page.url,
          title: pending.page.title,
          extractedText: pending.page.extractedText,
          contentHash: pending.page.contentHash,
        });
        await attachShot(saved.captureId);
        setSaveNote(
          withWebAvailability(
            `Saved to “${pending.workspaceName}”.`,
            saved.availableInWebProject,
          ),
        );
      }

      await refreshCaptures(pending.workspaceId, token);
      setPending(null);
      setProposalFields(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'save failed');
    } finally {
      setCommitting(false);
    }
  };

  /* ── Derived ─────────────────────────────────────────────────────── */

  const activeWsName = useMemo(
    () => workspaces.find((w) => w.id === activeWs)?.name ?? '',
    [workspaces, activeWs],
  );
  const activeLinkedProjectId = useMemo(
    () => workspaces.find((w) => w.id === activeWs)?.linked_project_id ?? null,
    [workspaces, activeWs],
  );
  const linkedProjectName = useMemo(() => {
    if (!activeLinkedProjectId) return null;
    return webProjects.find((p) => p.id === activeLinkedProjectId)?.name ?? null;
  }, [webProjects, activeLinkedProjectId]);

  const actionsBlocked =
    access?.status === 'restricted' || access?.status === 'no-tab';

  /**
   * One docked composer, relabelled per pane. Saved and Account have nothing to
   * ask, so they get none and the shell row collapses.
   */
  const composer = useMemo(() => {
    if (tab === 'page') {
      return {
        value: question,
        placeholder: 'Ask about this page…',
        label: 'Ask about this page',
        submitLabel: 'Ask',
        disabled: actionsBlocked || !session,
        onChange: setQuestion,
        onSubmit: () => void onAsk(),
        autoFocus: false,
        webSearch,
        onWebSearchChange: setWebSearch,
      };
    }
    if (tab === 'recall') {
      return {
        value: recallQ,
        placeholder: 'What did I save about…',
        label: 'Search your saved captures',
        submitLabel: 'Recall',
        disabled: !session,
        onChange: setRecallQ,
        onSubmit: () => void onRecall(),
        // Recall exists only to be queried, and arriving here is a deliberate
        // navigation — so the caret belongs in the field.
        autoFocus: true,
        webSearch: undefined,
        onWebSearchChange: undefined,
      };
    }
    return null;
    // onAsk / onRecall are stable enough for this panel's lifetime; including
    // them would rebuild the composer on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, question, recallQ, webSearch, actionsBlocked, session]);

  const confirmView = useMemo(() => {
    if (!pending) return null;
    if (pending.kind === 'capture') {
      const rows: ConfirmSummaryRow[] = [
        { label: 'Page', value: pending.page.title || pending.page.url },
        { label: 'From', value: pending.page.url },
        {
          label: 'Text',
          value: `${pending.page.extractedText.length.toLocaleString()} characters`,
        },
        { label: 'Into', value: pending.workspaceName },
      ];
      return {
        title: 'Save this page?',
        intent: 'This stores the page text in your WalkCroach memory.',
        confirmLabel: 'Save page',
        summary: rows,
        fields: null,
        irreversible: false,
      };
    }
    if (pending.kind === 'connector') {
      const { proposal } = pending;
      return {
        title: `${proposal.title}?`,
        intent: proposal.consequence,
        confirmLabel: proposal.title,
        summary: proposal.rows,
        fields: null,
        irreversible: proposal.irreversible,
      };
    }
    if (pending.kind === 'selection') {
      const { selection } = pending;
      const rows: ConfirmSummaryRow[] = [
        { label: 'Selection', value: preview(selection.text) },
        { label: 'From', value: selection.title || selection.url },
        {
          label: 'Length',
          value: `${selection.text.length.toLocaleString()} characters${
            selection.truncated ? ' (clipped by Chrome)' : ''
          }`,
        },
        { label: 'Into', value: pending.workspaceName },
      ];
      return {
        title: 'Save this selection?',
        intent:
          'Only the text you highlighted is saved — not the rest of the page.',
        confirmLabel: 'Save selection',
        summary: rows,
        fields: null,
        irreversible: false,
      };
    }
    if (pending.kind === 'price') {
      return {
        title: 'Start tracking this price?',
        intent: `Checks are appended to “${pending.workspaceName}”. Correct anything the model misread.`,
        confirmLabel: 'Track price',
        summary: null,
        fields: proposalFields,
        irreversible: false,
      };
    }
    return {
      title: 'Save these details?',
      intent: `Goes into “${pending.workspaceName}”. Edit any field before saving.`,
      confirmLabel: 'Save details',
      summary: null,
      fields: proposalFields,
      irreversible: false,
    };
  }, [pending, proposalFields]);

  /* ── Render ──────────────────────────────────────────────────────── */

  return (
    <div className="wc-shell">
      <BrandHeader session={session} onAccountClick={() => setTab('account')} />

      <main className="wc-main">
        {loading && (
          <div className="wc-section" aria-busy="true">
            <span className="wc-sr-only" role="status">
              Connecting to WalkCroach
            </span>
            <div className="wc-skeleton" style={{ width: '55%' }} />
            <div className="wc-skeleton" style={{ width: '85%' }} />
            <div className="wc-skeleton" style={{ width: '70%' }} />
          </div>
        )}

        {error && (
          <div className="wc-error" role="alert">
            <span>{error}</span>
            <div className="wc-error__actions">
              <button
                type="button"
                className="wc-btn wc-btn--ghost"
                onClick={() => setError(null)}
              >
                Dismiss
              </button>
              {!session && !loading && (
                <button
                  type="button"
                  className="wc-btn"
                  onClick={() => void bootstrap()}
                >
                  Retry
                </button>
              )}
            </div>
          </div>
        )}

        {!loading && !session && !error && (
          <div className="wc-section">
            <p className="wc-status">Not connected.</p>
            <div>
              <button
                type="button"
                className="wc-btn"
                onClick={() => void bootstrap()}
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {/* ── Page ── */}
        {!loading && session && tab === 'page' && (
          <div id="wc-pane-page" role="tabpanel" aria-labelledby="wc-tab-page">
            <div className="wc-section">
              {coach.show && <CoachMark onDismiss={coach.dismiss} />}

              <ContextHeader
                access={access}
                profile={profile}
                extractChars={extract ? extract.extractedText.length : null}
              />

              <AccessNotice
                access={access}
                onGrant={() => void onGrantSite()}
                onRecheck={() => void recheckAccess()}
              />

              <PrimaryActions
                profile={profile}
                disabled={actionsBlocked}
                streaming={streaming || committing}
                primaryDemoted={
                  Boolean(pending) || access?.status === 'needs-grant'
                }
                activeWorkspaceName={activeWsName}
                onSectorAction={() => void onSectorAction()}
                onSummarize={() => void onSummarize()}
                onDraft={() => void onDraft()}
                onSave={() => void onSave()}
                onOpenInWebChat={() => void onOpenInWebChat()}
              />

              {confirmView && (
                <ConfirmCard
                  title={confirmView.title}
                  intent={confirmView.intent}
                  confirmLabel={confirmView.confirmLabel}
                  fields={confirmView.fields}
                  summary={confirmView.summary}
                  busy={committing}
                  irreversible={confirmView.irreversible}
                  extra={
                    /*
                      Screenshots are offered only for captures of a real page.
                      A price track re-checks a URL over time, so a snapshot of
                      one visit would be noise.
                    */
                    pending &&
                    (pending.kind === 'capture' ||
                      pending.kind === 'selection') ? (
                      <>
                        {shot ? (
                          <>
                            <img
                              className="wc-shot"
                              src={shot.dataUrl}
                              alt={`Screenshot of the visible page, ${shot.width} by ${shot.height} pixels`}
                            />
                            <div className="wc-context__meta">
                              <span>Screenshot will be saved with this capture.</span>
                              <button
                                type="button"
                                className="wc-btn wc-btn--danger"
                                disabled={committing}
                                onClick={() => setShot(null)}
                              >
                                Remove
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="wc-btn"
                              disabled={shotBusy || committing || actionsBlocked}
                              onClick={() => void onCaptureScreenshot()}
                            >
                              {shotBusy ? 'Capturing…' : 'Add a screenshot'}
                            </button>
                            <span className="wc-muted wc-small">
                              Captures what is visible on screen right now,
                              including anything else in the window.
                            </span>
                          </>
                        )}
                      </>
                    ) : null
                  }
                  onFieldChange={(key, value) =>
                    setProposalFields((prev) =>
                      prev ? { ...prev, [key]: value } : prev,
                    )
                  }
                  onConfirm={() => void onCommit()}
                  onDismiss={() => {
                    if (pending?.kind === 'connector' && token) {
                      void declineConnectorRun(token, pending.proposal.runId);
                    }
                    setPending(null);
                    setProposalFields(null);
                  }}
                />
              )}

              {priceHistory && priceHistory.length > 0 && (
                <PriceHistory
                  history={priceHistory}
                  priceChanged={priceChanged}
                />
              )}

              {saveNote && <p className="wc-note">{saveNote}</p>}

              {/*
                Before the first action there is genuinely nothing to show, and
                an empty panel invites the question this answers: what happens
                when I press one of those, and where does the output go?
              */}
              {!pending &&
                !streaming &&
                !streamText &&
                !priceHistory &&
                !actionsBlocked && (
                  <EmptyState title="Nothing read yet">
                    Pick an action above and the result appears here. WalkCroach
                    reads this page at that moment — not before. Anything you
                    save is recallable from <strong>Recall</strong>, on every
                    WalkCroach surface.
                  </EmptyState>
                )}

              {!pending && (
                <Stream
                  text={streamText}
                  streaming={streaming}
                  onInsert={() => {
                    void chrome.runtime
                      .sendMessage({
                        type: 'INSERT_DRAFT',
                        payload: { text: streamText },
                      })
                      .then((res: { ok?: boolean; error?: string }) => {
                        if (!res?.ok) {
                          setError(
                            res?.error ??
                              'Could not insert — focus a text field on the page, then try again.',
                          );
                        }
                      });
                  }}
                  onCopy={() => {
                    void navigator.clipboard
                      .writeText(streamText)
                      .then(() => setSaveNote('Copied to clipboard.'))
                      .catch(() =>
                        setError('Could not copy — select the text manually.'),
                      );
                  }}
                />
              )}
            </div>
          </div>
        )}

        {/* ── Recall ── */}
        {!loading && session && tab === 'recall' && (
          <div
            id="wc-pane-recall"
            role="tabpanel"
            aria-labelledby="wc-tab-recall"
            className="wc-section"
          >
            <h2 className="wc-section__title">Recall</h2>
            <p className="wc-muted wc-small">
              Search what you saved
              {activeWsName ? ` in “${activeWsName}”` : ' across all workspaces'}
              .
            </p>
            {!streamText && !streaming && (
              <EmptyState title="Your memory, across surfaces">
                Anything you save from Chrome is recallable here — and in
                WalkCroach Web, if the workspace is linked to a project.
              </EmptyState>
            )}
            <RecallSources sources={recallSources} />
            <Stream text={streamText} streaming={streaming} />
          </div>
        )}

        {/* ── Saved ── */}
        {!loading && session && tab === 'saved' && (
          <div
            id="wc-pane-saved"
            role="tabpanel"
            aria-labelledby="wc-tab-saved"
            className="wc-section"
          >
            <h2 className="wc-section__title">Workspaces</h2>
            <div className="wc-ask">
              <label className="wc-sr-only" htmlFor="wc-new-ws">
                New workspace name
              </label>
              <input
                id="wc-new-ws"
                className="wc-input"
                value={newWsName}
                placeholder="New workspace name"
                onChange={(e) => setNewWsName(e.target.value)}
              />
              <button
                type="button"
                className="wc-btn"
                disabled={!newWsName.trim()}
                onClick={() => {
                  if (!token || !newWsName.trim()) return;
                  void createWorkspace(token, newWsName.trim())
                    .then((ws) => {
                      setWorkspaces((w) => [ws, ...w]);
                      setActiveWs(ws.id);
                      setNewWsName('');
                    })
                    .catch((err) =>
                      setError(
                        err instanceof Error
                          ? err.message
                          : 'create workspace failed',
                      ),
                    );
                }}
              >
                Create
              </button>
            </div>

            <ul className="wc-list">
              {workspaces.map((w) => (
                <li
                  key={w.id}
                  className={
                    w.id === activeWs ? 'wc-list__item--selected' : undefined
                  }
                >
                  <button
                    type="button"
                    className="wc-btn wc-btn--ghost"
                    aria-current={w.id === activeWs ? 'true' : undefined}
                    onClick={() => setActiveWs(w.id)}
                  >
                    {w.name}
                    {w.linked_project_id ? ' · linked' : ''}
                  </button>
                  <button
                    type="button"
                    className="wc-btn wc-btn--danger"
                    aria-label={`Delete workspace ${w.name}`}
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

            {!workspaces.length && (
              <EmptyState title="No workspaces yet">
                Workspaces group what you save — “Leads”, “Suppliers”,
                “Candidates”. Create one above, or just hit Save on a page and
                WalkCroach will make one for you.
              </EmptyState>
            )}

            {activeWs && (
              <>
                <h3 className="wc-section__title">Link to a Web project</h3>
                {session.source !== 'cognito' ? (
                  <p className="wc-muted wc-small">
                    {linkHint ??
                      'Sign in under Account to link a WalkCroach Web project.'}
                  </p>
                ) : (
                  <>
                    <label className="wc-sr-only" htmlFor="wc-link-project">
                      Linked Web project
                    </label>
                    <select
                      id="wc-link-project"
                      className="wc-select"
                      value={activeLinkedProjectId ?? ''}
                      disabled={linking}
                      onChange={(e) => {
                        const projectId = e.target.value;
                        if (!token || !activeWs) return;
                        setLinking(true);
                        setError(null);
                        void linkWorkspaceProject(
                          token,
                          activeWs,
                          projectId || null,
                        )
                          .then(async (result) => {
                            setWorkspaces(await listWorkspaces(token));
                            setSaveNote(
                              result.message ??
                                (result.linkedProjectId
                                  ? 'Also available in your WalkCroach project.'
                                  : 'Unlinked from Web project.'),
                            );
                          })
                          .catch((err) =>
                            setError(
                              err instanceof Error ? err.message : 'link failed',
                            ),
                          )
                          .finally(() => setLinking(false));
                      }}
                    >
                      <option value="">Not linked</option>
                      {webProjects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    {linkedProjectName && (
                      <p className="wc-note">
                        Also available in “{linkedProjectName}”.
                      </p>
                    )}
                    {!webProjects.length && (
                      <p className="wc-muted wc-small">
                        No Web projects yet. Create one in WalkCroach Web, then
                        reopen this panel.
                      </p>
                    )}
                  </>
                )}

                <h3 className="wc-section__title">
                  Saved in {activeWsName || 'this workspace'}
                </h3>
                {captures.length ? (
                  <ul className="wc-list">
                    {captures.map((c) => (
                      <li key={c.id}>
                        <div className="wc-list__body">
                          <span className="wc-list__title">
                            {c.title || c.url}
                          </span>
                          <span className="wc-list__sub">{c.url}</span>
                          {c.capture_type === 'price' &&
                            typeof c.structured_fields === 'object' &&
                            c.structured_fields &&
                            'history' in (c.structured_fields as object) && (
                              <span className="wc-muted wc-small">
                                Price track ·{' '}
                                {
                                  (
                                    (
                                      c.structured_fields as {
                                        history?: unknown[];
                                      }
                                    ).history ?? []
                                  ).length
                                }{' '}
                                checks
                              </span>
                            )}
                        </div>
                        <button
                          type="button"
                          className="wc-btn wc-btn--danger"
                          aria-label={`Delete ${c.title || c.url}`}
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
                  </ul>
                ) : (
                  <EmptyState title="Nothing saved here yet">
                    On the <strong>Page</strong> tab, hit Save — or use the
                    sector action — and it lands here.
                  </EmptyState>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Account & Sites ── */}
        {!loading && tab === 'account' && (
          <div
            id="wc-pane-account"
            role="tabpanel"
            aria-labelledby="wc-tab-account"
            className="wc-section"
          >
            <h2 className="wc-section__title">Account &amp; sites</h2>
            <p className="wc-muted wc-small">
              WalkCroach reads a page only when you click an action, and only on
              sites you have allowed. Opening this panel uploads nothing.
            </p>

            <CreditMeter credits={credits} />

            <ConnectorsPanel
              providers={connectors?.providers ?? []}
              requiresSignIn={connectors?.requiresSignIn ?? true}
              connectUrl={connectors?.connectUrl ?? ''}
              busyProvider={disconnecting}
              onDisconnect={(p) => void onDisconnectConnector(p)}
              onOpenConnect={() => {
                const url = connectors?.connectUrl;
                if (url) void chrome.tabs.create({ url });
              }}
            />

            <SitesPanel
              origins={grantedOrigins}
              onRevoke={(o) => void onRevokeSite(o)}
            />

            <h3 className="wc-section__title">Session</h3>
            <p className="wc-muted wc-small wc-mono">
              {session?.ownerId ?? '—'} · {session?.source ?? 'device'}
            </p>

            {session?.source === 'device' && (
              <>
                <button
                  type="button"
                  className="wc-btn wc-btn--primary"
                  disabled={signingIn}
                  onClick={() => {
                    setError(null);
                    setSigningIn(true);
                    void startWebSignIn()
                      .then(async (outcome) => {
                        if (outcome.kind === 'delegated') {
                          setSaveNote(
                            'Complete sign-in in the WalkCroach tab that just opened.',
                          );
                          return;
                        }
                        setSession(outcome.session);
                        setSaveNote('Signed in. Your device captures merged.');
                        setWorkspaces(
                          await listWorkspaces(outcome.session.accessToken),
                        );
                        await refreshWebProjects(
                          outcome.session.accessToken,
                          outcome.session.source,
                        );
                        setCredits(
                          await fetchCredits(outcome.session.accessToken),
                        );
                      })
                      .catch((err) =>
                        setError(
                          err instanceof Error ? err.message : 'sign-in failed',
                        ),
                      )
                      .finally(() => setSigningIn(false));
                  }}
                >
                  {signingIn ? 'Signing in…' : 'Sign in with WalkCroach'}
                </button>
                <p className="wc-muted wc-small">
                  Same login as WalkCroach Web and the IDE extension. Anything
                  you saved on this device merges into your account.
                </p>
                <details>
                  <summary className="wc-muted wc-small">
                    Advanced: paste a Cognito token
                  </summary>
                  <div className="wc-ask" style={{ marginTop: '0.5rem' }}>
                    <label className="wc-sr-only" htmlFor="wc-cognito-token">
                      Cognito access or ID token
                    </label>
                    <input
                      id="wc-cognito-token"
                      className="wc-input"
                      placeholder="Paste token, then press Enter"
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return;
                        const el = e.target as HTMLInputElement;
                        const v = el.value.trim();
                        if (!v) return;
                        void upgradeToCognito(v)
                          .then(async (s) => {
                            setSession(s);
                            setError(null);
                            el.value = '';
                            setWorkspaces(await listWorkspaces(s.accessToken));
                            await refreshWebProjects(s.accessToken, s.source);
                          })
                          .catch((err) =>
                            setError(
                              err instanceof Error
                                ? err.message
                                : 'upgrade failed',
                            ),
                          );
                      }}
                    />
                  </div>
                </details>
              </>
            )}

            {session?.source === 'cognito' && (
              <div>
                <button
                  type="button"
                  className="wc-btn"
                  onClick={() =>
                    void signOutToDevice(createDeviceSession)
                      .then(async (s) => {
                        setSession(s);
                        setWebProjects([]);
                        setCredits(null);
                        setLinkHint(
                          'Sign in under Account to link a WalkCroach Web project.',
                        );
                        setWorkspaces(await listWorkspaces(s.accessToken));
                        setError(null);
                      })
                      .catch((err) =>
                        setError(
                          err instanceof Error ? err.message : 'sign-out failed',
                        ),
                      )
                  }
                >
                  Sign out
                </button>
              </div>
            )}

            <p className="wc-small">
              <a
                href={PRIVACY_URL}
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--steel)' }}
              >
                Privacy policy
              </a>
            </p>
          </div>
        )}
      </main>

      {composer && (
        <Composer
          value={composer.value}
          placeholder={composer.placeholder}
          label={composer.label}
          submitLabel={composer.submitLabel}
          disabled={composer.disabled}
          autoFocus={composer.autoFocus}
          streaming={streaming}
          webSearch={composer.webSearch}
          onWebSearchChange={composer.onWebSearchChange}
          onChange={composer.onChange}
          onSubmit={composer.onSubmit}
          onCancel={cancelStream}
        />
      )}

      <NavRail active={tab} onSelect={setTab} />
    </div>
  );
}
