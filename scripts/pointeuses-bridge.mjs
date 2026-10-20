import http from 'node:http';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
export const BRIDGE_PROTOCOL = 'myc-pointage-bridge-v1';
const readerPath = fileURLToPath(new URL('./read-pointeuses.py', import.meta.url));

async function collectAttendance({ from, through }) {
  const args = [readerPath, '--from-date', from, '--through-date', through];
  let output;
  try {
    output = await execute(process.env.POINTAGE_PYTHON || 'python', args, {
      timeout: 45000, maxBuffer: 32 * 1024 * 1024, windowsHide: true,
    });
  } catch (error) {
    if (error.killed) return { ok: false, code: 'timeout', devices: [], records: [] };
    if (!error.stdout) return { ok: false, code: 'reader_unavailable', devices: [], records: [] };
    output = error;
  }
  return JSON.parse(output.stdout);
}

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T12:00:00Z`))
    && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}

export function createBridgeServer({ allowedOrigins, collect = collectAttendance }) {
  const origins = new Set(allowedOrigins);
  let pending = null;
  let pendingPeriod = '';
  const server = http.createServer(async (request, response) => {
    const reply = (status, value) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(JSON.stringify({ protocol: BRIDGE_PROTOCOL, ...value }));
    };
    const port = server.address()?.port;
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(request.headers.host)) {
      reply(403, { code: 'invalid_host' }); return;
    }
    const origin = request.headers.origin;
    if (!origin || !origins.has(origin)) { reply(403, { code: 'origin_denied' }); return; }
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Pointage-Client');
    response.setHeader('Access-Control-Allow-Private-Network', 'true');
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
    if (request.url === '/health' && request.method === 'GET') {
      reply(200, { ready: true, reading: Boolean(pending) }); return;
    }
    if (request.url !== '/v1/attendance' || request.method !== 'POST') {
      reply(404, { code: 'not_found' }); return;
    }
    if (request.headers['x-pointage-client'] !== 'rh' || !request.headers['content-type']?.startsWith('application/json')) {
      reply(403, { code: 'client_required' }); return;
    }
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 2048) { reply(413, { code: 'request_too_large' }); return; }
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { reply(400, { code: 'invalid_period' }); return; }
      const { from, through } = body || {};
      const days = (Date.parse(through) - Date.parse(from)) / 86400000;
      if (!validDate(from) || !validDate(through) || days < 0 || days > 31) {
        reply(400, { code: 'invalid_period' }); return;
      }
      const period = `${from}|${through}`;
      if (pending && pendingPeriod !== period) { reply(409, { code: 'reading' }); return; }
      if (!pending) {
        pendingPeriod = period;
        pending = Promise.resolve().then(() => collect({ from, through }))
          .finally(() => { pending = null; pendingPeriod = ''; });
      }
      const result = await pending;
      reply(result.ok ? 200 : 503, { ...result, checkedAt: new Date().toISOString() });
    } catch {
      reply(503, { ok: false, code: 'reader_unavailable', devices: [], records: [] });
    }
  });
  server.requestTimeout = 60000;
  return server;
}

async function main() {
  const config = JSON.parse(await readFile(new URL('../config/pointeuses.json', import.meta.url), 'utf8'));
  const allowedOrigins = [...new Set(config.siteOrigins || [])];
  if (!allowedOrigins.length || allowedOrigins.some((origin) => new URL(origin).origin !== origin)) {
    throw new Error('Configurer les adresses exactes du site dans siteOrigins.');
  }
  const server = createBridgeServer({ allowedOrigins });
  server.listen(8787, '127.0.0.1', () => {
    console.log('Connecteur MYC demarre : http://127.0.0.1:8787');
    console.log('Lecture des pointages uniquement. Aucune suppression ni modification des terminaux.');
    console.log(`Sites autorises : ${allowedOrigins.join(', ')}`);
  });
  server.on('error', (error) => { console.error(`Connecteur indisponible : ${error.code}`); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('Configuration du connecteur invalide.'); process.exitCode = 1; });
}
