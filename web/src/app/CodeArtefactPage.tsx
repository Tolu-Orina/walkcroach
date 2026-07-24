import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  getCodeArtefact,
  getGithubStatus,
  type CodeArtefactDetail,
} from '../api/client';

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.split('/').pop() ?? 'artefact.txt';
  a.click();
  URL.revokeObjectURL(url);
}

export function CodeArtefactPage() {
  const { artefactId } = useParams<{ artefactId: string }>();
  const navigate = useNavigate();
  const [artefact, setArtefact] = useState<CodeArtefactDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [githubUrl, setGithubUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!artefactId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const row = await getCodeArtefact(artefactId);
        if (cancelled) return;
        setArtefact(row);
        if (row.projectId) {
          try {
            const gh = await getGithubStatus(row.projectId);
            if (gh.connected && gh.repo) {
              setGithubUrl(
                `https://github.com/${gh.repo}/blob/main/${row.path}`,
              );
            }
          } catch {
            // optional
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [artefactId]);

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-5 py-10 text-sm text-mist">
        Loading artefact…
      </div>
    );
  }

  if (error || !artefact) {
    return (
      <div className="mx-auto max-w-5xl px-5 py-10">
        <p className="text-sm text-ember">{error ?? 'Artefact not found'}</p>
        <Link to="/app/code" className="btn-ghost mt-4 inline-flex text-sm">
          ← Code library
        </Link>
      </div>
    );
  }

  const content = artefact.content ?? '';
  const isHtml =
    artefact.language === 'html' ||
    artefact.path.endsWith('.html') ||
    artefact.path.endsWith('.htm');

  return (
    <div className="mx-auto max-w-5xl px-5 py-10 sm:px-8">
      <Link
        to="/app/code"
        className="interactive text-[11px] font-semibold text-mist hover:text-signal"
      >
        ← Code library
      </Link>
      <p className="eyebrow mt-4">Artefact</p>
      <h1 className="mt-2 font-display text-2xl font-extrabold tracking-tight text-paper sm:text-3xl">
        {artefact.path.split('/').pop()}
      </h1>
      <p className="mt-1 font-mono text-sm text-mist">{artefact.path}</p>
      <p className="mt-1 text-[12px] text-mist">
        {artefact.source}
        {artefact.projectName ? ` · ${artefact.projectName}` : ''}
        {artefact.language ? ` · ${artefact.language}` : ''}
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        {content && (
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => downloadText(artefact.path, content)}
          >
            Download
          </button>
        )}
        {artefact.projectId && (
          <button
            type="button"
            className="btn-primary text-xs"
            onClick={() =>
              navigate(`/app/projects/${artefact.projectId}/builder`)
            }
          >
            Open in Builder
          </button>
        )}
        {artefact.projectId && (
          <Link
            to={`/app/projects/${artefact.projectId}`}
            className="btn-ghost text-xs"
          >
            Project home
          </Link>
        )}
        {githubUrl && (
          <a
            href={githubUrl}
            target="_blank"
            rel="noreferrer"
            className="btn-ghost text-xs"
          >
            Open on GitHub
          </a>
        )}
      </div>

      {isHtml && content ? (
        <div className="mt-8 overflow-hidden rounded-[var(--radius-surface)] border border-line">
          <p className="border-b border-line bg-raised/60 px-3 py-1.5 text-[11px] uppercase tracking-wider text-mist">
            Preview
          </p>
          <iframe
            title="HTML preview"
            sandbox=""
            srcDoc={content}
            className="h-64 w-full bg-white"
          />
        </div>
      ) : null}

      <div className="mt-8 overflow-hidden rounded-[var(--radius-surface)] border border-line">
        <p className="border-b border-line bg-raised/60 px-3 py-1.5 text-[11px] uppercase tracking-wider text-mist">
          Source
        </p>
        <pre className="max-h-[min(60vh,36rem)] overflow-auto bg-ink/80 p-4 font-mono text-[12px] leading-relaxed text-mist">
          {content || '— empty —'}
        </pre>
      </div>
    </div>
  );
}
