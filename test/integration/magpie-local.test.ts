import { afterEach, describe, expect, it, vi } from 'vitest';
import { DoubaoTranslatePlugin } from '../../src/magpie/plugin.js';
import { startMock } from '../fixtures/mock-doubao.js';

const base = 'https://doubao-translate.invalid/v1/chat/completions';
const fixtureCookie = 'sessionid=test-only; sid_tt=test-only; uid_tt=test-only';
const nativeFetch = globalThis.fetch;
const cleanup: Array<() => Promise<unknown> | void> = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const clean of cleanup.splice(0).reverse()) await clean();
});
const init = (text = 'hello') => ({ method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'doubao-ai', target_lang: 'zh', messages: [{ role: 'user', content: text }] }) });
async function loader(options: Record<string, unknown> = {}) {
  const plugin = await DoubaoTranslatePlugin({}, options);
  return plugin.auth.loader(async () => ({ type: 'api', key: fixtureCookie }));
}
async function within<T>(pending: Promise<T>, ms = 200): Promise<T | 'still-pending'> {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([pending, new Promise<'still-pending'>(resolve => {
    timer = setTimeout(() => resolve('still-pending'), ms);
  })]); } finally { clearTimeout(timer!); }
}

describe('local Magpie hardening', () => {
  it('keeps Immersive Translate paragraph separators out of upstream text', async () => {
    const mock = await startMock(); cleanup.push(mock.close);
    vi.stubGlobal('fetch', (input: string | URL | Request, options?: RequestInit) => {
      const url = new URL(String(input));
      return nativeFetch(mock.url + url.pathname + url.search, options);
    });
    const plugin = await loader();
    const response = await plugin.fetch(base, init('first\r\n\r\n%%\r\n\r\nsecond'));
    expect(response.status).toBe(200);
    expect((await response.json()).choices[0].message.content).toBe('译:first\r\n\r\n%%\r\n\r\n译:second');
    expect(mock.requests[0]?.body.raw_text).toEqual(['first', 'second']);
  });

  it('times out an upstream body even when the fetch bridge ignores abort', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    vi.stubGlobal('fetch', async () => new Response(new ReadableStream<Uint8Array>({
      start(value) { controller = value; },
    }), { headers: { 'Content-Type': 'text/event-stream' } }));
    cleanup.push(() => { try { controller.close(); } catch { /* Already cancelled. */ } });
    const plugin = await loader({ requestTimeoutMs: 20, totalTimeoutMs: 1000 });
    const response = await within(plugin.fetch(base, init()));
    expect(response).not.toBe('still-pending');
    expect((response as Response).status).toBe(504);
    expect((await (response as Response).json()).error.code).toBe('upstream_timeout');
  });

  it('does not await a stuck stream cancellation after its deadline', async () => {
    let finishCancel!: () => void;
    const cancelled = new Promise<void>(resolve => { finishCancel = resolve; });
    cleanup.push(finishCancel);
    vi.stubGlobal('fetch', async () => new Response(new ReadableStream<Uint8Array>({
      cancel() { return cancelled; },
    }), { headers: { 'Content-Type': 'text/event-stream' } }));
    const plugin = await loader({ requestTimeoutMs: 20, totalTimeoutMs: 1000 });
    const response = await within(plugin.fetch(base, init()));
    expect(response).not.toBe('still-pending');
    expect((response as Response).status).toBe(504);
  });

  it('bounds the response-header wait when the fetch bridge ignores abort', async () => {
    let complete!: (response: Response) => void;
    const cancel = vi.fn();
    vi.stubGlobal('fetch', () => new Promise<Response>(resolve => { complete = resolve; }));
    cleanup.push(() => complete(new Response('', { status: 500 })));
    const plugin = await loader({ requestTimeoutMs: 20, totalTimeoutMs: 1000 });
    const response = await within(plugin.fetch(base, init()));
    expect(response).not.toBe('still-pending');
    expect((response as Response).status).toBe(504);
    complete(new Response(new ReadableStream<Uint8Array>({ cancel }), {
      headers: { 'Content-Type': 'text/event-stream' },
    }));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('cancels a late authentication response without waiting for its cancel hook', async () => {
    let complete!: (response: Response) => void;
    let finishCancel!: () => void;
    const cancelled = new Promise<void>(resolve => { finishCancel = resolve; });
    const cancel = vi.fn(() => cancelled);
    vi.stubGlobal('fetch', () => new Promise<Response>(resolve => { complete = resolve; }));
    cleanup.push(finishCancel);
    const plugin = await DoubaoTranslatePlugin({}, { authTimeoutMs: 20 });
    const flow = await plugin.auth.methods[1]!.authorize({ cookie: fixtureCookie });
    const result = await within(flow.callback());
    expect(result).toMatchObject({ type: 'failed' });
    complete(new Response(new ReadableStream<Uint8Array>({ cancel }), {
      headers: { 'Content-Type': 'application/json' },
    }));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('bounds Cookie validation while reading a stalled authentication body', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    vi.stubGlobal('fetch', async () => new Response(new ReadableStream<Uint8Array>({
      start(value) { controller = value; },
    }), { headers: { 'Content-Type': 'application/json' } }));
    cleanup.push(() => { try { controller.close(); } catch { /* Already cancelled. */ } });
    const plugin = await DoubaoTranslatePlugin({}, { authTimeoutMs: 20 });
    const flow = await plugin.auth.methods[1]!.authorize({ cookie: fixtureCookie });
    const result = await within(flow.callback());
    expect(result).not.toBe('still-pending');
    expect(result).toMatchObject({ type: 'failed' });
    expect(JSON.stringify(result)).not.toContain('test-only');
  });

  it('bounds loading a stored Cookie without falsely expiring the login', async () => {
    const plugin = await DoubaoTranslatePlugin({}, { authTimeoutMs: 20 });
    const active = await plugin.auth.loader(() => new Promise(() => {}));
    const response = await within(active.fetch(base, init()));
    expect(response).not.toBe('still-pending');
    expect((response as Response).status).toBe(504);
    expect((response as Response).headers.get('X-Magpie-Sign-In')).toBeNull();
    expect((await (response as Response).json()).error.code).toBe('auth_timeout');
  });

  it('caps default concurrent translations and rejects excess queued work', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    cleanup.push(release);
    let calls = 0;
    vi.stubGlobal('fetch', async (_input: unknown, options: RequestInit) => {
      calls++;
      await gate;
      const texts = JSON.parse(options.body as string).raw_text;
      return new Response('event: json\ndata: ' + JSON.stringify({ code: 0, data: {
        items: texts.map((text: string, index: number) => ({ index, res: '译:' + text })),
      } }) + '\n\nevent: done\ndata: {}\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
    });
    const plugin = await loader();
    const requests = Array.from({ length: 12 }, () => plugin.fetch(base, init()));
    await vi.waitFor(() => expect(calls).toBeGreaterThanOrEqual(2), { interval: 1 });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(calls).toBe(2);
    release();
    const results = await Promise.all(requests);
    expect(results.filter(response => response.status === 429)).toHaveLength(2);
    expect(results.filter(response => response.status === 200)).toHaveLength(10);
  });

  it.each([{ maxConcurrency: 1000 }, { queueMax: 1000 }, { maxRetries: 10 },
    { requestTimeoutMs: 86400000 }, { totalTimeoutMs: 86400000 }])('rejects unbounded resource options %j', async options => {
    await expect(DoubaoTranslatePlugin({}, options)).rejects.toThrow('Invalid Doubao plugin options');
  });
});
