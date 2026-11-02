type SubscribeInput = { email?: unknown; language?: unknown };

function json(status: number, body: { ok: boolean; error?: string }): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/** Cloudflare Pages Function: forward an explicit subscription to UFACTORY's own service. */
export async function onRequestPost(context: { request: Request }): Promise<Response> {
  const { request } = context;
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return json(403, { ok: false, error: 'origin' });
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
    return json(415, { ok: false, error: 'invalid' });
  }
  let body: SubscribeInput;
  try {
    const text = await request.text();
    if (text.length > 2048) return json(413, { ok: false, error: 'invalid' });
    body = JSON.parse(text) as SubscribeInput;
  } catch {
    return json(400, { ok: false, error: 'invalid' });
  }
  if (!body || typeof body.email !== 'string' || (body.language !== 'zh' && body.language !== 'en')) {
    return json(400, { ok: false, error: 'invalid' });
  }
  const email = body.email.trim();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(email)) return json(400, { ok: false, error: 'invalid' });

  const payload = new FormData();
  payload.set('email', email);
  const endpoint = body.language === 'zh'
    ? 'https://www.ufactory.cc/zh-cn/ajax?subscribe'
    : 'https://www.ufactory.cc/ajax?subscribe';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(endpoint, { method: 'POST', body: payload, signal: controller.signal });
    if (!response.ok) return json(502, { ok: false, error: 'upstream' });
    const result: { code?: unknown } = await response.json();
    if (typeof result.code !== 'number') return json(502, { ok: false, error: 'upstream' });
    if (result.code === 0) return json(400, { ok: false, error: 'invalid' });
    return json(200, { ok: true });
  } catch {
    return json(502, { ok: false, error: 'upstream' });
  } finally {
    clearTimeout(timer);
  }
}
