// Mirrors web/src/templates/scaffold.ts — proxy-only DB access (no credentials in client).
const PROXY = import.meta.env.VITE_WALKCROACH_PROXY ?? '';
const TOKEN = import.meta.env.VITE_WALKCROACH_TOKEN ?? '';

export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await fetch(`${PROXY}/sql`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
    },
    body: JSON.stringify({ sql, params }),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as { rows: T[] };
  return data.rows;
}
