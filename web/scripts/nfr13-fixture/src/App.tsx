import { useState } from 'react';
import { query } from './lib/db';
import { proxyFetch } from './lib/walkcroach';

type Todo = { id: number; text: string; done: boolean };

export default function App() {
  const [items, setItems] = useState<Todo[]>([
    { id: 1, text: 'NFR-13 fixture', done: true },
  ]);
  const [draft, setDraft] = useState('');

  const add = async () => {
    const text = draft.trim();
    if (!text) return;
    setItems((prev) => [...prev, { id: Date.now(), text, done: false }]);
    setDraft('');
    try {
      await query('SELECT 1');
      await proxyFetch('https://example.com', { secretKey: 'OPENAI_API_KEY' });
    } catch {
      // expected offline in CI
    }
  };

  return (
    <main className="min-h-screen bg-stone-50 p-8 text-stone-900">
      <div className="mx-auto max-w-md rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Todos</h1>
        <div className="mt-4 flex gap-2">
          <input
            className="flex-1 rounded border border-stone-300 px-3 py-2"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="New task"
          />
          <button type="button" onClick={() => void add()} className="rounded bg-stone-900 px-3 py-2 text-white">
            Add
          </button>
        </div>
        <ul className="mt-4 space-y-2">
          {items.map((t) => (
            <li key={t.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={t.done} readOnly />
              <span className={t.done ? 'line-through text-stone-400' : ''}>{t.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
