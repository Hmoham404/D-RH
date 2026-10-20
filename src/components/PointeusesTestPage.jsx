import { useEffect, useRef, useState } from 'react';
import configuration from '../../config/pointeuses.json';
import { getLocalPointageDate } from '../lib/pointageDates.js';
import { getPayrollPeriod } from '../lib/pointagePeriod.js';
import { preparePointeuseImport } from '../lib/pointeuseImport.js';
import { pointeuseTestTranslations } from '../lib/pointeuseTestTranslations.js';
import { readPointeuseAttendance, testPointeuseConnections } from '../services/pointeuseBridge.js';
import { savePointageSnapshot } from '../services/pointageSnapshotStore.js';
import DashboardIcon from './DashboardIcon';

const PAGE_SIZE = 50;
export default function PointeusesTestPage({ employees, snapshot, loading, onSaved, pointageBreakMinutes = 24, language, locale }) {
  const texts = pointeuseTestTranslations[language] || pointeuseTestTranslations.fr;
  const t = (key, values = {}) => (texts[key] || key).replace(/\{(\w+)\}/g, (_, name) => values[name] ?? '');
  const [devices, setDevices] = useState([]);
  const [records, setRecords] = useState([]);
  const [status, setStatus] = useState({ key: 'idle' });
  const [busy, setBusy] = useState('');
  const [page, setPage] = useState(0);
  const [checkedAt, setCheckedAt] = useState(null);
  const controller = useRef(null);
  const active = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  const today = getLocalPointageDate();
  const from = getPayrollPeriod(today).start;
  const formatDate = (value) => new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${value}T12:00:00`));

  async function run(mode) {
    if (active.current) return;
    active.current = true;
    setBusy(mode);
    setStatus({ key: mode === 'test' ? 'testing' : 'reading' });
    // A new test never displays stale punches from an earlier read.
    setRecords([]); setDevices([]); setPage(0); setCheckedAt(null);
    const abort = new AbortController();
    controller.current = abort;
    const timer = setTimeout(() => abort.abort(), 55000);
    try {
      const result = await (mode === 'test' ? testPointeuseConnections : readPointeuseAttendance)(from, today, abort.signal);
      if (!mounted.current) return;
      const received = mode === 'read' ? result.records : [];
      if (received.length > 100000 || received.some((record) => !record || typeof record.userId !== 'string'
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(record.timestamp)
        || typeof record.terminal !== 'string')) throw new Error('invalid_records');
      setDevices(result.devices);
      setRecords(received);
      setCheckedAt(result.checkedAt || new Date().toISOString());
      setStatus(mode === 'test' ? { key: 'tested', values: { connected: result.devices.filter((item) => item.connected).length, total: result.devices.length } }
        : { key: 'loaded', values: { count: received.length } });
    } catch (error) {
      if (!mounted.current) return;
      setDevices(Array.isArray(error.devices) ? error.devices : []);
      setCheckedAt(error.checkedAt || null);
      const key = { unreachable: 'network', communication_key: 'keyError', reading: 'busy' }[error.code]
        || (texts[error.code] ? error.code : abort.signal.aborted ? 'timeout' : 'failure');
      setStatus({ key, error: true });
    } finally {
      clearTimeout(timer); controller.current = null; active.current = false;
      if (mounted.current) setBusy('');
    }
  }

  async function save() {
    if (active.current || loading || !employees.length || !records.length) return;
    active.current = true; setBusy('save');
    try {
      const prepared = await preparePointeuseImport(records, snapshot, employees,
        { dateOrder: 'mdy', breakMinutes: pointageBreakMinutes, roundingMinutes: 1, closeDays: true }, getLocalPointageDate());
      if (prepared.added) {
        const result = await savePointageSnapshot(prepared.snapshot, { expectedUpdatedAt: snapshot?.storageRevision ?? null });
        if (result.mode !== 'supabase') throw new Error('save_failed');
        onSaved(result.data);
      }
      if (mounted.current) setStatus({ key: prepared.added ? 'saved' : 'noNew', values: { count: prepared.added } });
    } catch {
      if (mounted.current) setStatus({ key: 'saveFailed', error: true });
    } finally { active.current = false; if (mounted.current) setBusy(''); }
  }

  return <div className="clock-test" aria-busy={Boolean(busy)}>
    <header className="clock-test__heading">
      <div><p className="clock-test__eyebrow">MYC · ZKTECO</p><h1>{t('title')}</h1><p>{t('intro')}</p></div>
      <span className="clock-test__read-only"><DashboardIcon type="lock" />{t('tag')}</span>
    </header>
    <section className="clock-test__devices" aria-label={t('title')}>
      {configuration.devices.map((device, index) => {
        const result = devices.find((item) => item.host === device.host);
        const state = result ? result.connected ? 'connected' : result.code === 'communication_key' ? 'communication_key' : 'unreachable' : 'untested';
        return <article key={device.host} className={`clock-device clock-device--${state}`}>
          <div className="clock-device__top"><span className="clock-device__number">0{index + 1}</span>
            <span className="clock-device__status"><i aria-hidden="true" />{busy === 'test' || busy === 'read' ? t('testing') : t(state)}</span></div>
          <DashboardIcon type="clock" /><h2>{device.name}</h2><code>{device.host}:{device.port}</code>
        </article>;
      })}
    </section>
    <section className="clock-test__controls" aria-label={t('period')}>
      <div><span>{t('period')}</span><strong>{formatDate(from)} — {formatDate(today)}</strong></div>
      <div className="clock-test__buttons">
        <button className="ghost-button" type="button" disabled={Boolean(busy)} onClick={() => run('test')}>{t(busy === 'test' ? 'testing' : 'test')}</button>
        <button className="clock-test__primary" type="button" disabled={Boolean(busy)} onClick={() => run('read')}><DashboardIcon type="clock" />{t(busy === 'read' ? 'reading' : 'read')}</button>
      </div>
    </section>
    <div className={`clock-test__feedback${status.error ? ' is-error' : ''}`} role="status">
      <span>{t(status.key, status.values)}</span>
      {checkedAt && <time dateTime={checkedAt}>{new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(checkedAt))}</time>}
    </div>
    <section className="clock-test__preview" aria-label={t('preview')}>
      <header><div><h2>{t('preview')}{records.length > 0 && <span className="clock-test__count">{records.length}</span>}</h2><p>{t('previewHint')}</p></div>
        <button className="ghost-button" type="button" disabled={Boolean(busy) || loading || !employees.length || !records.length} onClick={save}>{t(busy === 'save' ? 'saving' : 'save')}</button>
      </header>
      {!records.length ? <div className="clock-test__empty"><div><DashboardIcon type="clock" /></div><h3>{t('empty')}</h3><p>{t('emptyHint')}</p></div>
        : <><div className="clock-test__table"><table><thead><tr>{['id', 'date', 'time', 'terminal'].map((key) => <th key={key}>{t(key)}</th>)}</tr></thead>
          <tbody>{records.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((record, index) => <tr key={`${page}-${index}`}><td>{record.userId}</td><td>{formatDate(record.timestamp.slice(0, 10))}</td><td><code>{record.timestamp.slice(11)}</code></td><td>{record.terminal}</td></tr>)}</tbody></table></div>
          <footer><span>{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, records.length)} / {records.length}</span>
            <div><button className="ghost-button" disabled={page === 0} onClick={() => setPage(page - 1)}>{t('previous')}</button><button className="ghost-button" disabled={(page + 1) * PAGE_SIZE >= records.length} onClick={() => setPage(page + 1)}>{t('next')}</button></div></footer></>}
    </section>
  </div>;
}
