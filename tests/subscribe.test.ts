import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestPost } from '../functions/api/subscribe';

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://viewer.example/api/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://viewer.example', ...headers },
    body: JSON.stringify(body),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('subscription proxy', () => {
  it.each([
    ['zh', 'https://www.ufactory.cc/zh-cn/ajax?subscribe'],
    ['en', 'https://www.ufactory.cc/ajax?subscribe'],
  ])('forwards the %s request to the official endpoint', async (language, endpoint) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 1, message: 'ok' })));
    vi.stubGlobal('fetch', fetchMock);
    const response = await onRequestPost({ request: request({ email: ' viewer@example.com ', language }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(endpoint);
    expect(options.method).toBe('POST');
    expect((options.body as FormData).get('email')).toBe('viewer@example.com');
  });

  it('rejects invalid input and cross-origin requests without contacting the service', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const invalid = await onRequestPost({ request: request({ email: 'not-an-email', language: 'zh' }) });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ ok: false, error: 'invalid' });
    const origin = await onRequestPost({ request: request({ email: 'a@example.com', language: 'en' }, { Origin: 'https://other.example' }) });
    expect(origin.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('distinguishes upstream validation from service failures', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, field_error: ['email'] })))
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
      .mockRejectedValueOnce(new Error('network'));
    vi.stubGlobal('fetch', fetchMock);
    const input = { email: 'a@example.com', language: 'en' };
    const invalid = await onRequestPost({ request: request(input) });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ ok: false, error: 'invalid' });
    for (let i = 0; i < 2; i++) {
      const failure = await onRequestPost({ request: request(input) });
      expect(failure.status).toBe(502);
      expect(await failure.json()).toEqual({ ok: false, error: 'upstream' });
    }
  });
});
