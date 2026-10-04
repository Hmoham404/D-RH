import { mkdir, writeFile } from 'node:fs/promises';
import { loadEnv } from 'vite';
import { createClient } from '@supabase/supabase-js';

const env = loadEnv('development', process.cwd(), '');
const db = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(20000) }) },
});
const { data, error } = await db.from('hr_dashboard_store')
  .select('id,payload,updated_at').eq('id', 'rh-pointage-analysis').single();
if (error) throw new Error(error.message);
await mkdir('.pointage-backups', { recursive: true });
await writeFile('.pointage-backups/current-dates-audit.json', JSON.stringify(data));
const describe = (snapshot) => ({
  fileName: snapshot?.fileName, dateNormalizationVersion: snapshot?.dateNormalizationVersion,
  sourceOnlyVersion: snapshot?.sourceOnlyVersion, calculationRules: snapshot?.calculationRules,
  period: [snapshot?.periodStart, snapshot?.periodEnd],
  diagnostics: snapshot?.importDiagnostics,
  rows: snapshot?.rawRows?.length,
  dates: [...new Set((snapshot?.rawRows || []).map((r) => r.isoDate))].sort(),
  samples: (snapshot?.rawRows || []).slice(0, 8).map(({ sourceDateValue, pointageAt, pointageAtDisplay, isoDate }) =>
    ({ sourceDateValue, pointageAt, pointageAtDisplay, isoDate })),
});
console.log(JSON.stringify({ updatedAt: data.updated_at, root: describe(data.payload),
  current: describe(data.payload.currentFilePointage), backup: '.pointage-backups/current-dates-audit.json' }, null, 2));
