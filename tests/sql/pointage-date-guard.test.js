import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { parsePointageSourceDate } from '../../src/lib/pointageDateSource.js';

const migration = await readFile(new URL('../../sql/pointage-date-guard.sql', import.meta.url), 'utf8');
let db;
let sequence = 0;
const serial = (month, day, hour = 7, minute = 36, second = 0) =>
  (Date.UTC(2026, month - 1, day, hour, minute, second) - Date.UTC(1899, 11, 30)) / 86400000;

function row(encoding = 'mdy-text', overrides = {}) {
  const source = encoding === 'excel-visible-mdy' ? serial(1, 10)
    : encoding === 'excel-serial' ? serial(10, 1)
      : encoding === 'iso-text' ? '2026-10-01T07:36:00' : '10/01/2026 07:36';
  return {
    sourceId: '4', sourceName: 'SQL fixture', employeeKey: '4',
    sourceDateValue: source, sourceDateText: '10/01/2026 07:36',
    sourceDateFormat: encoding === 'excel-visible-mdy' ? 'dd/mm/yyyy hh:mm' : '',
    sourceDateEncoding: encoding, sourceDateIso: '2026-10-01T07:36:00',
    isoDate: '2026-10-01', pointageAt: '2026-10-01T07:36:00',
    pointageAtDisplay: '01/10/2026 07:36:00', ...overrides,
  };
}

function snapshot(rows = [row()]) {
  return {
    fileName: '1003.xlsx', dateNormalizationVersion: 9, sourceDateContract: 'mdy-visible-v1',
    calculationRules: { dateOrder: 'mdy', breakMinutes: 24 }, rawRows: rows,
  };
}

async function insert(payload, id = `rh-pointage-history-sql-${++sequence}`, updatedAt = '2026-10-04T12:00:00Z') {
  return db.query('insert into public.hr_dashboard_store(id,payload,updated_at) values($1,$2::jsonb,$3::timestamptz) returning id,payload,updated_at::text',
    [id, JSON.stringify(payload), updatedAt]);
}

before(async () => {
  db = new PGlite();
  await db.exec('create table public.hr_dashboard_store(id text primary key,payload jsonb not null,updated_at timestamptz default now())');
  await db.exec(migration);
});
after(async () => { await db?.close(); });

for (const encoding of ['mdy-text', 'excel-visible-mdy', 'excel-serial', 'iso-text', 'canonical-iso']) {
  test(`PostgreSQL accepts correct October source (${encoding})`, async () => {
    const result = await insert(snapshot([row(encoding)]));
    assert.equal(result.rows[0].payload.rawRows[0].isoDate, '2026-10-01');
    assert.equal(result.rows[0].payload.rawRows[0].sourceDateIso, '2026-10-01T07:36:00');
  });
}

test('visible MDY numeric source can be validated when only its serial and encoding remain', async () => {
  const punch = row('excel-visible-mdy');
  delete punch.sourceDateText;
  const result = await insert(snapshot([punch]));
  assert.equal(result.rows[0].payload.rawRows[0].isoDate, '2026-10-01');
});

test('numeric March 10 calendar sources stay March while visible MDY 10/03 sources stay October', async () => {
  const calendar = row('excel-serial', {
    sourceDateValue: serial(3, 10), sourceDateText: '03/10/2026 07:36',
    isoDate: '2026-03-10', pointageAt: '2026-03-10T07:36:00', sourceDateIso: '2026-03-10T07:36:00',
  });
  const visible = row('excel-visible-mdy', {
    sourceDateValue: serial(3, 10), sourceDateText: '10/03/2026 07:36',
    isoDate: '2026-10-03', pointageAt: '2026-10-03T07:36:00', sourceDateIso: '2026-10-03T07:36:00',
  });
  await insert(snapshot([calendar, visible]));
});

for (const format of ['m/d/yy', 'm/d/yy h:mm']) {
  test(`regional Excel built-in format ${format} preserves October 1, 2 and 3 despite SheetJS US display text`, async () => {
    const regionalRows = [1, 2, 3].map((month) => row('excel-localized-mdy', {
      sourceDateValue: serial(month, 10), sourceDateText: `${month}/10/26${format.includes('h:') ? ' 7:36' : ''}`,
      sourceDateFormat: format,
      isoDate: `2026-10-0${month}`, pointageAt: `2026-10-0${month}T07:36:00`, sourceDateIso: `2026-10-0${month}T07:36:00`,
    }));
    const payload = snapshot(regionalRows);
    payload.currentFilePointage = snapshot(regionalRows);
    const result = await insert(payload);
    assert.deepEqual(result.rows[0].payload.rawRows.map((punch) => punch.isoDate), ['2026-10-01', '2026-10-02', '2026-10-03']);
    assert.deepEqual(result.rows[0].payload.currentFilePointage.rawRows.map((punch) => punch.isoDate), ['2026-10-01', '2026-10-02', '2026-10-03']);
  });
}

test('regional source cannot be saved as January even when SheetJS shows January 10', async () => {
  await assert.rejects(insert(snapshot([row('excel-localized-mdy', {
    sourceDateValue: serial(1, 10), sourceDateText: '1/10/26 7:36', sourceDateFormat: 'm/d/yy h:mm',
    isoDate: '2026-01-10', pointageAt: '2026-01-10T07:36:00', sourceDateIso: '2026-01-10T07:36:00',
  })])), /Date du pointage differente de la source MDY/);
});

test('regional serial dates beyond day 12 retain their native September, October and December dates', async () => {
  const nativeDates = [[9, 30], [10, 13], [12, 31]];
  const rows = nativeDates.map(([month, day]) => {
    const date = `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return row('excel-localized-mdy', {
      sourceDateValue: serial(month, day), sourceDateText: `${month}/${day}/26 7:36`,
      sourceDateFormat: 'm/d/yy h:mm', isoDate: date,
      pointageAt: `${date}T07:36:00`, sourceDateIso: `${date}T07:36:00`,
    });
  });
  const payload = snapshot(rows);
  payload.currentFilePointage = snapshot(rows);
  const inserted = (await insert(payload)).rows[0];
  assert.deepEqual(inserted.payload.rawRows.map((punch) => punch.isoDate), ['2026-09-30', '2026-10-13', '2026-12-31']);
  const reloaded = await db.query('select payload from public.hr_dashboard_store where id=$1', [inserted.id]);
  for (const part of [reloaded.rows[0].payload, reloaded.rows[0].payload.currentFilePointage]) {
    for (const punch of part.rawRows) {
      const parsed = parsePointageSourceDate(punch.sourceDateValue, {
        encoding: punch.sourceDateEncoding, text: punch.sourceDateText, format: punch.sourceDateFormat,
      });
      assert.ok(parsed);
      const date = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
      assert.equal(date, punch.isoDate);
    }
  }
});

test('explicit visible MDY continues to reject a month beyond 12', async () => {
  await assert.rejects(insert(snapshot([row('excel-visible-mdy', {
    sourceDateValue: serial(9, 30), sourceDateText: '30/09/2026 07:36',
    isoDate: '2026-09-30', pointageAt: '2026-09-30T07:36:00', sourceDateIso: '2026-09-30T07:36:00',
  })])), /date field value out of range/);
});

for (const encoding of ['excel-serial', 'excel-visible-mdy', 'excel-localized-mdy']) {
  test(`fractional serials rounded past midnight match the importer (${encoding})`, async () => {
    const source = serial(encoding === 'excel-serial' ? 10 : 1, encoding === 'excel-serial' ? 1 : 10, 23, 59, 59)
      + 999.6 / 86400000;
    const parsed = parsePointageSourceDate(source, { encoding });
    assert.ok(parsed);
    const pad = (value) => String(value).padStart(2, '0');
    const date = `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
    const timestamp = `${date}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}:${pad(parsed.getSeconds())}`;
    await insert(snapshot([row(encoding, {
      sourceDateValue: source, sourceDateText: '', isoDate: date, pointageAt: timestamp, sourceDateIso: timestamp,
    })]));
  });
}

test('nested currentFilePointage is validated together with the top-level snapshot', async () => {
  const payload = snapshot();
  payload.currentFilePointage = snapshot([row('excel-visible-mdy')]);
  await insert(payload);
  payload.currentFilePointage.rawRows[0].isoDate = '2026-01-10';
  payload.currentFilePointage.rawRows[0].pointageAt = '2026-01-10T07:36:00';
  payload.currentFilePointage.rawRows[0].sourceDateIso = '2026-01-10T07:36:00';
  await assert.rejects(insert(payload), /Date du pointage differente de la source MDY/);
});

test('old versions 6 and 8 cannot insert or overwrite current or history pointage', async () => {
  const ids = ['rh-pointage-analysis', `rh-pointage-history-sql-${++sequence}`];
  for (const id of ids) await insert(snapshot(), id);
  for (const version of [6, 8]) {
    const legacy = { ...snapshot(), dateNormalizationVersion: version };
    await assert.rejects(insert(legacy, 'rh-pointage-analysis'), /version de normalisation.*au moins 9/);
    await assert.rejects(insert(legacy, `rh-pointage-history-old-v${version}-${++sequence}`), /version de normalisation.*au moins 9/);
    for (const id of ids) {
      await assert.rejects(db.query('update public.hr_dashboard_store set payload=$1::jsonb where id=$2', [JSON.stringify(legacy), id]),
        /version de normalisation.*au moins 9/);
      const result = await db.query('select payload->>\'dateNormalizationVersion\' as version from public.hr_dashboard_store where id=$1', [id]);
      assert.equal(result.rows[0].version, '9');
    }
  }
});

test('sourceDateIso must exactly match the canonical timestamp', async () => {
  await assert.rejects(insert(snapshot([row('mdy-text', { sourceDateIso: '2026-01-10T07:36:00' })])),
    /Dates ISO du pointage incoherentes/);
});

test('source MDY dates cannot be saved as January 10 even with internally consistent ISO fields', async () => {
  await assert.rejects(insert(snapshot([row('mdy-text', {
    isoDate: '2026-01-10', pointageAt: '2026-01-10T07:36:00', sourceDateIso: '2026-01-10T07:36:00',
  })])), /Date du pointage differente de la source MDY/);
});

test('server revisions remain monotonic under a frozen client clock and stale CAS changes no rows', async () => {
  const id = `rh-pointage-history-sql-${++sequence}`;
  const frozen = '2026-10-04T12:00:00Z';
  const first = (await insert(snapshot(), id, frozen)).rows[0].updated_at;
  const second = await db.query('update public.hr_dashboard_store set payload=$1::jsonb,updated_at=$2::timestamptz where id=$3 and updated_at=$4::timestamptz returning updated_at::text',
    [JSON.stringify(snapshot()), frozen, id, first]);
  assert.equal(second.rows.length, 1);
  const newer = second.rows[0].updated_at;
  const comparison = await db.query('select $1::timestamptz > $2::timestamptz as newer', [newer, first]);
  assert.equal(comparison.rows[0].newer, true);
  const stale = await db.query('update public.hr_dashboard_store set payload=$1::jsonb,updated_at=$2::timestamptz where id=$3 and updated_at=$4::timestamptz returning id',
    [JSON.stringify({ ...snapshot(), fileName: 'obsolete-recalculation.xlsx' }), frozen, id, first]);
  assert.equal(stale.rows.length, 0);
});

test('unrelated dashboard payloads keep their data and timestamps', async () => {
  const payload = { arbitrary: ['10/01/2026'], totals: { active: 1 } };
  const inserted = (await insert(payload, 'rh-homepage', '2026-10-04T12:00:00Z')).rows[0];
  assert.deepEqual(inserted.payload, payload);
  const timestamp = await db.query('select updated_at = $1::timestamptz as same from public.hr_dashboard_store where id=\'rh-homepage\'', ['2026-10-04T12:00:00Z']);
  assert.equal(timestamp.rows[0].same, true);
});

test('cleared pointage remains permitted without old source data', async () => {
  const result = await insert({ cleared: true }, `rh-pointage-history-sql-${++sequence}`);
  assert.deepEqual(result.rows[0].payload, { cleared: true });
});

test('migration can be reexecuted and keeps exactly one guard trigger', async () => {
  await db.exec(migration);
  const result = await db.query("select count(*)::integer as count from pg_trigger where tgname='hr_pointage_date_guard' and tgrelid='public.hr_dashboard_store'::regclass and not tgisinternal");
  assert.equal(result.rows[0].count, 1);
  await insert(snapshot());
});

test('invalid clock values rejected by the importer are also rejected by PostgreSQL guard', async () => {
  for (const time of ['24:00:00', '07:36:60']) {
    await assert.rejects(insert(snapshot([row('mdy-text', {
      pointageAt: `2026-10-01T${time}`, sourceDateIso: `2026-10-01T${time}`,
    })])), `clock ${time} must be rejected`);
  }
});
