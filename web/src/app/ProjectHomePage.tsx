import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  archiveProject,
  createProjectDocument,
  createSession,
  deleteProject,
  deleteProjectDocument,
  getProject,
  listProjectDocuments,
  listProjectMemory,
  listProjectSessions,
  patchProject,
} from '../api/client';
import type {
  ProjectDetail,
  ProjectDocument,
  ProjectMemoryEntry,
  ProjectSession,
} from '../api/types';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { BuilderIconLink } from '../features/builder/BuilderIconLink';
import {
  displayMemoryText,
  memorySurfaceLabel,
} from '../features/memory/memoryDisplay';

/**
 * Project home — chat compilation + knowledge container.
 * App Builder is a room off this project (icon), not the project itself.
 */
export function ProjectHomePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [sessions, setSessions] = useState<ProjectSession[]>([]);
  const [memorySummary, setMemorySummary] = useState<string | null>(null);
  const [memoryEntries, setMemoryEntries] = useState<ProjectMemoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveOk, setSaveOk] = useState(false);
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [docName, setDocName] = useState('');
  const [docText, setDocText] = useState('');
  const [addingDoc, setAddingDoc] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [memoryFilter, setMemoryFilter] = useState<'all' | 'chrome' | 'other'>(
    'all',
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const loadGen = useRef(0);

  const [memoryError, setMemoryError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    const gen = ++loadGen.current;
    setLoading(true);
    setError(null);
    setMemoryError(null);
    try {
      // Memory rides the IDE/SDK BFF — soft-fail so an IDE outage does not
      // blank the whole project home (name, docs, chats live on agent API).
      const [core, memResult] = await Promise.all([
        Promise.all([
          getProject(projectId),
          listProjectDocuments(projectId),
          listProjectSessions(projectId),
        ]),
        listProjectMemory(projectId)
          .then((mem) => ({ ok: true as const, mem }))
          .catch((err: unknown) => ({
            ok: false as const,
            message: err instanceof Error ? err.message : String(err),
          })),
      ]);
      if (gen !== loadGen.current) return;
      const [p, docs, sess] = core;
      setProject(p);
      setDescription(p.description ?? '');
      setInstructions(p.instructions ?? '');
      setDocuments(docs);
      setSessions(sess);
      if (memResult.ok) {
        setMemorySummary(p.memorySummary ?? memResult.mem.summary);
        setMemoryEntries(memResult.mem.entries ?? []);
      } else {
        setMemorySummary(p.memorySummary ?? null);
        setMemoryEntries([]);
        setMemoryError(
          'message' in memResult ? memResult.message : 'Memory unavailable',
        );
      }
    } catch (err) {
      if (gen !== loadGen.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (gen === loadGen.current) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
    return () => {
      loadGen.current += 1;
    };
  }, [load]);

  const saveKnowledge = async () => {
    if (!projectId || saving) return;
    setSaving(true);
    setError(null);
    setSaveOk(false);
    try {
      const updated = await patchProject(projectId, {
        description: description.trim() || null,
        instructions: instructions.trim() || null,
      });
      setProject(updated);
      setDescription(updated.description ?? '');
      setInstructions(updated.instructions ?? '');
      setSaveOk(true);
      window.setTimeout(() => setSaveOk(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const addDocument = async () => {
    if (!projectId || !docName.trim() || addingDoc) return;
    setAddingDoc(true);
    setError(null);
    try {
      const created = await createProjectDocument(projectId, {
        name: docName.trim(),
        mime: 'text/plain',
        textContent: docText,
      });
      setDocName('');
      setDocText('');
      const docs = await listProjectDocuments(projectId);
      setDocuments(docs);
      if (created.ingestStatus === 'failed') {
        setError(
          'Document saved, but RAG indexing failed. It may not appear in semantic search until re-uploaded.',
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAddingDoc(false);
    }
  };

  const onFile = async (file: File | null) => {
    if (!file || !projectId) return;
    setAddingDoc(true);
    setError(null);
    try {
      const text = await file.text();
      const created = await createProjectDocument(projectId, {
        name: file.name,
        mime: file.type || 'text/plain',
        textContent: text.slice(0, 200_000),
      });
      const docs = await listProjectDocuments(projectId);
      setDocuments(docs);
      if (created.ingestStatus === 'failed') {
        setError(
          'Document saved, but RAG indexing failed. It may not appear in semantic search until re-uploaded.',
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAddingDoc(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const removeDocument = async (id: string) => {
    if (!projectId) return;
    try {
      await deleteProjectDocument(projectId, id);
      setDocuments((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const startChat = async () => {
    if (!projectId) return;
    try {
      const session = await createSession(projectId, 'chat');
      navigate(`/app/projects/${projectId}/chat/${session.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleArchive = async () => {
    if (!projectId) return;
    try {
      await archiveProject(projectId);
      navigate('/app/projects', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const confirmDelete = async () => {
    if (!projectId) return;
    setDeleteBusy(true);
    try {
      await deleteProject(projectId);
      navigate('/app/projects', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDeleteBusy(false);
      setDeleteOpen(false);
    }
  };

  if (!projectId) {
    return null;
  }

  if (loading) {
    return (
      <div className="grid h-full place-items-center text-sm text-mist">
        Loading project…
      </div>
    );
  }

  if (error && !project) {
    return (
      <div className="grid h-full place-items-center px-6 text-center text-sm text-ember">
        {error}
      </div>
    );
  }

  if (!project) return null;

  const chats = sessions.filter((s) => s.mode === 'chat');

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto px-4 py-8 sm:px-8">
      <div className="mx-auto w-full max-w-3xl">
        <Link
          to="/app/projects"
          className="interactive text-[11px] uppercase tracking-[0.16em] text-mist hover:text-signal"
        >
          ← Projects
        </Link>

        <header className="mt-4 border-b border-line pb-6">
          <p className="text-[11px] uppercase tracking-[0.2em] text-signal">
            Project
          </p>
          <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="font-display text-3xl font-extrabold text-paper">
                {project.name}
              </h1>
              <p className="mt-1 text-sm text-mist">
                Chats over this project’s life share the description,
                instructions, and documents below.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void startChat()}
                className="btn-primary text-xs"
              >
                New chat
              </button>
              <BuilderIconLink projectId={projectId} label="Builder" />
            </div>
          </div>
        </header>

        {error && <p className="mt-4 text-sm text-ember">{error}</p>}

        <section className="mt-8 space-y-3">
          <div className="flex items-end justify-between gap-3">
            <h2 className="font-display text-lg font-bold text-paper">
              Chats
            </h2>
            <span className="text-[11px] text-mist">
              {chats.length} in this project
            </span>
          </div>
          {chats.length === 0 ? (
            <p className="text-sm text-mist">
              No chats yet — start one to keep work in this project’s timeline.
            </p>
          ) : (
            <ul className="divide-y divide-line border border-line">
              {chats.map((s) => (
                <li key={s.id}>
                  <Link
                    to={`/app/projects/${projectId}/chat/${s.id}`}
                    className="interactive flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-panel/40"
                  >
                    <span className="truncate text-sm text-paper">
                      {s.title?.trim() || `Chat ${s.id.slice(0, 8)}`}
                    </span>
                    <span className="shrink-0 text-[10px] text-mist">
                      {new Date(s.createdAt).toLocaleString()}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="font-display text-lg font-bold text-paper">
            Knowledge
          </h2>
          <p className="text-sm text-mist">
            Applies to every chat in this project — not just the current thread.
          </p>
          <label className="block">
            <span className="text-[11px] uppercase tracking-wider text-mist">
              Description
            </span>
            <textarea
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                setSaveOk(false);
              }}
              rows={2}
              placeholder="What is this project about?"
              className="mt-1 w-full rounded-sm border border-line bg-panel/40 px-3 py-2 text-sm text-paper placeholder:text-mist/50 focus:border-signal/50 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-[11px] uppercase tracking-wider text-mist">
              Standing instructions
            </span>
            <textarea
              value={instructions}
              onChange={(e) => {
                setInstructions(e.target.value);
                setSaveOk(false);
              }}
              rows={5}
              placeholder="Tone, stack, constraints the agent should always follow…"
              className="mt-1 w-full rounded-sm border border-line bg-panel/40 px-3 py-2 text-sm text-paper placeholder:text-mist/50 focus:border-signal/50 focus:outline-none"
            />
          </label>
          <button
            type="button"
            onClick={() => void saveKnowledge()}
            disabled={saving}
            className="btn-primary text-xs"
          >
            {saving ? 'Saving…' : saveOk ? 'Saved' : 'Save knowledge'}
          </button>
          {saveOk && (
            <p className="text-sm text-teal" role="status">
              Knowledge saved — applies to every chat in this project.
            </p>
          )}
        </section>

        <section className="mt-10 space-y-4">
          <div className="flex items-end justify-between gap-3">
            <h2 className="font-display text-lg font-bold text-paper">
              Documents
            </h2>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={addingDoc}
              className="btn-ghost text-xs"
            >
              Upload file
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.md,.json,.csv,.ts,.tsx,.js,.jsx,.html,.css"
              className="hidden"
              onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
            />
          </div>
          {documents.length === 0 ? (
            <p className="text-sm text-mist">No documents yet.</p>
          ) : (
            <ul className="divide-y divide-line border border-line">
              {documents.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate text-paper">{d.name}</p>
                    <p className="text-[10px] text-mist">
                      {d.ingestStatus === 'ok' || (d.chunkCount ?? 0) > 0
                        ? `RAG indexed${d.chunkCount ? ` (${d.chunkCount} chunks)` : ''}`
                        : d.hasText
                          ? 'Saved — indexing failed'
                          : 'No text'}{' '}
                      · {new Date(d.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void removeDocument(d.id)}
                    className="interactive shrink-0 text-[11px] text-ember/90 hover:text-ember"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="space-y-2 border border-dashed border-line p-3">
            <p className="text-[11px] uppercase tracking-wider text-mist">
              Paste document
            </p>
            <input
              value={docName}
              onChange={(e) => setDocName(e.target.value)}
              placeholder="Name"
              className="w-full rounded-sm border border-line bg-panel/40 px-3 py-2 text-sm text-paper placeholder:text-mist/50 focus:border-signal/50 focus:outline-none"
            />
            <textarea
              value={docText}
              onChange={(e) => setDocText(e.target.value)}
              rows={4}
              placeholder="Paste brief, brand notes, API docs…"
              className="w-full rounded-sm border border-line bg-panel/40 px-3 py-2 text-sm text-paper placeholder:text-mist/50 focus:border-signal/50 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void addDocument()}
              disabled={addingDoc || !docName.trim()}
              className="btn-ghost text-xs"
            >
              {addingDoc ? 'Adding…' : 'Add document'}
            </button>
          </div>
        </section>

        <section className="mt-10 space-y-3">
          <h2 className="font-display text-lg font-bold text-paper">
            Remembered
          </h2>
          {memorySummary && (
            <p className="rounded-sm border border-line bg-panel/30 px-3 py-2 text-sm text-mist">
              {memorySummary}
            </p>
          )}
          {memoryError && (
            <p
              className="rounded-sm border border-ember/30 bg-ember/10 px-3 py-2 text-sm text-ember"
              role="status"
            >
              Memory service unavailable — project details still loaded.{' '}
              <button
                type="button"
                className="underline hover:text-paper"
                onClick={() => void load()}
              >
                Retry
              </button>
            </p>
          )}
          {!memoryError && memoryEntries.length === 0 && (
            <p className="text-sm text-mist">
              No memory entries yet — preferences appear here as you chat.
              Saves from WalkCroach Chrome also show up here when this project
              is linked.
            </p>
          )}
          {!memoryError && memoryEntries.length > 0 && (
            <>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ['all', 'All'],
                    ['chrome', 'From Chrome'],
                    ['other', 'Other'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setMemoryFilter(id)}
                    className={
                      memoryFilter === id
                        ? 'btn-ghost text-xs ring-1 ring-signal/50'
                        : 'btn-ghost text-xs'
                    }
                  >
                    {label}
                    {id === 'chrome'
                      ? ` (${memoryEntries.filter((e) => e.sourceSurface === 'chrome').length})`
                      : ''}
                  </button>
                ))}
              </div>
              <ul className="space-y-2">
                {memoryEntries
                  .filter((e) => {
                    if (memoryFilter === 'chrome')
                      return e.sourceSurface === 'chrome';
                    if (memoryFilter === 'other')
                      return e.sourceSurface !== 'chrome';
                    return true;
                  })
                  .slice(0, 12)
                  .map((e) => (
                    <li
                      key={e.id}
                      className={
                        e.sourceSurface === 'chrome'
                          ? 'border-l-2 border-signal pl-3 text-sm text-paper/90'
                          : 'border-l-2 border-signal/40 pl-3 text-sm text-paper/90'
                      }
                    >
                      <span className="text-[10px] uppercase tracking-wider text-mist">
                        {e.kind} · {memorySurfaceLabel(e.sourceSurface)}
                        {e.sourceSurface === 'chrome' ? ' · browser save' : ''}
                      </span>
                      <p className="mt-0.5 line-clamp-3 text-mist">
                        {displayMemoryText(e.text, e.sourceSurface)}
                      </p>
                    </li>
                  ))}
              </ul>
            </>
          )}
        </section>

        <section className="mt-12 flex flex-wrap gap-3 border-t border-line pt-6">
          <button
            type="button"
            onClick={() => void handleArchive()}
            className="btn-ghost text-xs"
          >
            Archive
          </button>
          <button
            type="button"
            onClick={() => setDeleteOpen(true)}
            className="interactive text-xs text-ember/90 hover:text-ember"
          >
            Delete project
          </button>
        </section>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        title="Delete project?"
        message="This removes the project from your account. Access is revoked immediately; data is soft-deleted and cannot be recovered from the UI."
        confirmLabel="Delete"
        destructive
        busy={deleteBusy}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  );
}
