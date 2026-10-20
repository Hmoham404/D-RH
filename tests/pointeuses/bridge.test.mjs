import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createBridgeServer, BRIDGE_PROTOCOL } from '../../scripts/pointeuses-bridge.mjs';

const origin = 'https://d-rh-hn7b.vercel.app';
const period = { from: '2026-09-26', through: '2026-10-20' };
async function fixture(t, collect) {
  const server = createBridgeServer({ allowedOrigins: [origin], collect });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const read = (body = period, headers = {}) => fetch(`${url}/v1/attendance`, { method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Pointage-Client': 'rh', ...headers },
    body: JSON.stringify(body) });
  return { server, url, read };
}

test('only the named site can read and private-network preflight stays restricted to that origin', async (t) => {
  let reads = 0;
  const { url, read } = await fixture(t, () => { reads++; });
  assert.equal((await read(period, { Origin: 'https://unrelated.example' })).status, 403);
  assert.equal((await read(period, { Origin: 'null' })).status, 403);
  assert.equal((await fetch(`${url}/health`)).status, 403);
  const preflight = await fetch(`${url}/v1/attendance`, { method: 'OPTIONS', headers: { Origin: origin } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
  assert.equal(preflight.headers.get('access-control-allow-private-network'), 'true');
  assert.equal(reads, 0);
});

test('bad periods and missing client header never reach a terminal', async (t) => {
  let reads = 0;
  const { read } = await fixture(t, () => { reads++; });
  for (const body of [null, {}, { from: '2026-02-31', through: '2026-03-01' },
    { from: '2026-10-20', through: '2026-10-01' }, { from: '2026-01-01', through: '2026-10-20' }]) {
    assert.equal((await read(body)).status, 400);
  }
  assert.equal((await read(period, { 'X-Pointage-Client': '' })).status, 403);
  assert.equal(reads, 0);
});

test('concurrent browser reads share one device session and subsequent reads are fresh', async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let reads = 0;
  const { server, read } = await fixture(t, async (requested) => {
    assert.deepEqual(requested, period);
    reads++;
    await gate;
    return { ok: true, devices: [{ connected: true }], records: [{ userId: '1', timestamp: '2026-10-20T08:00:00' }] };
  });
  let bodies = 0;
  server.on('request', (request) => request.once('end', () => {
    if (++bodies === 2) setImmediate(release);
  }));
  const responses = await Promise.all([read(), read()]);
  for (const response of responses) {
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.protocol, BRIDGE_PROTOCOL);
    assert.equal(body.records.length, 1);
  }
  assert.equal(reads, 1);
  assert.equal((await read()).status, 200);
  assert.equal(reads, 2);
});

test('an unreachable device is reported as failure, never as a successful empty import', async (t) => {
  const { read } = await fixture(t, async () => ({ ok: false,
    devices: [{ connected: false, host: '10.10.100.201', code: 'unreachable' }], records: [] }));
  const response = await read();
  assert.equal(response.status, 503);
  assert.equal((await response.json()).devices[0].connected, false);
});

test('connection testing uses a separate read-only operation and cannot share an attendance request', async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const calls = [];
  const { url, read } = await fixture(t, async (requested) => {
    calls.push(requested);
    await gate;
    return { ok: true, devices: [{ host: '10.10.100.201', connected: true }], records: [] };
  });
  const connection = fetch(`${url}/v1/connection`, { method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Pointage-Client': 'rh' }, body: JSON.stringify(period) });
  // Wait for the connection test to be active before attempting an attendance read.
  while (!calls.length) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal((await read()).status, 409);
  release();
  assert.equal((await connection).status, 200);
  assert.deepEqual(calls, [{ ...period, connectionOnly: true }]);
});
