import { expect, test } from 'bun:test';
import { app } from '#app';

test('health answers without touching dependencies', async () => {
  const res = await app.request('/health');
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ success: true, data: { status: 'ok' } });
});

test('unknown paths get the JSON 404', async () => {
  const res = await app.request('/nowhere');
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ success: false, error: 'Not found', code: 'not_found' });
});

test('every response carries a request id, echoing one the caller sent', async () => {
  const generated = await app.request('/health');
  expect(generated.headers.get('X-Request-Id')).toBeTruthy();

  const echoed = await app.request('/health', { headers: { 'X-Request-Id': 'abc' } });
  expect(echoed.headers.get('X-Request-Id')).toBe('abc');
});

test('CORS allows the web origin with credentials and nobody else', async () => {
  const preflight = (origin: string) =>
    app.request('/health', {
      method: 'OPTIONS',
      headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' },
    });

  const allowed = await preflight('http://localhost:3000');
  expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000');
  expect(allowed.headers.get('Access-Control-Allow-Credentials')).toBe('true');

  const denied = await preflight('https://evil.example');
  expect(denied.headers.get('Access-Control-Allow-Origin')).toBeNull();
});
