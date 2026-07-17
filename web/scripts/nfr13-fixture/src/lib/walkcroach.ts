// Mirrors web/src/templates/scaffold.ts — secretKey is a vault key name, not a secret value.
const PROXY = import.meta.env.VITE_WALKCROACH_PROXY ?? '';
const TOKEN = import.meta.env.VITE_WALKCROACH_TOKEN ?? '';

export async function proxyFetch(
  url: string,
  init: RequestInit & { secretKey?: string; secretHeader?: string } = {},
): Promise<Response> {
  const { secretKey, secretHeader, ...rest } = init;
  const res = await fetch(`${PROXY}/http`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
    },
    body: JSON.stringify({
      url,
      method: rest.method ?? 'GET',
      headers: rest.headers,
      body: rest.body as string | undefined,
      secretKey,
      secretHeader,
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as {
    status: number;
    body: string;
    headers: Record<string, string>;
  };
  return new Response(data.body, { status: data.status, headers: data.headers });
}
