import { completeWebSignIn } from '../../lib/auth';

const statusEl = document.getElementById('status');

function setStatus(text: string, kind?: 'ok' | 'err') {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.className = kind ?? '';
}

async function main() {
  const params = new URLSearchParams(location.search);
  const err = params.get('error');
  const code = params.get('code');
  const state = params.get('state');

  if (err) {
    setStatus(`Sign-in failed: ${err}`, 'err');
    return;
  }
  if (!code || !state) {
    setStatus(
      'Missing connect code. Close this tab and click Sign in again in the side panel.',
      'err',
    );
    return;
  }

  try {
    await completeWebSignIn(code, state);
    setStatus(
      'Signed in. You can close this tab and return to the WalkCroach side panel.',
      'ok',
    );
    setTimeout(() => window.close(), 1200);
  } catch (e) {
    setStatus(e instanceof Error ? e.message : 'Sign-in failed', 'err');
  }
}

void main();
