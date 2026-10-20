import { useEffect, useRef, useState } from 'react';
import { getPayrollPeriod } from '../lib/pointagePeriod.js';
import { getLocalPointageDate } from '../lib/pointageDates.js';
import { readPointeuseAttendance } from '../services/pointeuseBridge.js';

const AUTO_KEY = 'rh-pointeuses-auto';
function initialAutomatic() {
  try { return localStorage.getItem(AUTO_KEY) !== '0'; } catch { return true; }
}

export default function PointeusesSyncPanel({ disabled, onSync, translate: t }) {
  const [automatic, setAutomatic] = useState(initialAutomatic);
  const [reading, setReading] = useState(false);
  const [state, setState] = useState({ key: 'ready', values: {} });
  const active = useRef(false);
  const controller = useRef(null);
  const initialRead = useRef(false);
  const sync = useRef(null);
  const save = useRef(onSync);
  save.current = onSync;
  sync.current = async () => {
    if (disabled || active.current) return;
    active.current = true;
    setReading(true);
    setState({ key: 'reading', values: {} });
    const abort = new AbortController();
    controller.current = abort;
    const timeout = setTimeout(() => abort.abort(), 55000);
    try {
      const today = getLocalPointageDate();
      const result = await readPointeuseAttendance(getPayrollPeriod(today).start, today, abort.signal);
      const { added } = await save.current(result.records);
      const connected = result.devices.filter((device) => device.connected).length;
      setState({ key: 'synced', values: { connected, total: result.devices.length, count: added } });
    } catch (error) {
      if (!abort.signal.aborted) {
        const known = ['bridge_unavailable', 'communication_key', 'unreachable', 'dependency_missing', 'reader_unavailable', 'timeout'];
        setState({ key: known.includes(error.code) ? error.code : 'saveFailed', values: {} });
      } else if (controller.current === abort) {
        setState({ key: 'timeout', values: {} });
      }
    } finally {
      clearTimeout(timeout);
      if (controller.current === abort) controller.current = null;
      active.current = false;
      setReading(false);
    }
  };
  useEffect(() => {
    if (!automatic || disabled) return;
    const first = setTimeout(() => {
      if (!initialRead.current) { initialRead.current = true; sync.current(); }
    }, 0);
    const interval = setInterval(() => sync.current(), 5 * 60 * 1000);
    return () => { clearTimeout(first); clearInterval(interval); };
  }, [automatic, disabled]);
  useEffect(() => () => { controller.current?.abort(); }, []);
  function changeAutomatic(value) {
    setAutomatic(value);
    initialRead.current = false;
    try { localStorage.setItem(AUTO_KEY, value ? '1' : '0'); } catch { /* Optional preference. */ }
  }
  return <section className="pointeuse-sync" aria-label={t('daily.pointeuses.title')} aria-busy={reading}>
    <div className="pointeuse-sync__copy">
      <strong>{t('daily.pointeuses.title')}</strong>
      <p role="status" className={['synced', 'ready', 'reading'].includes(state.key) ? '' : 'pointeuse-sync__notice'}>
        {t(`daily.pointeuses.${state.key}`, state.key, state.values)}
      </p>
    </div>
    <div className="pointeuse-sync__actions">
      <label><input type="checkbox" checked={automatic} disabled={reading}
        onChange={(event) => changeAutomatic(event.target.checked)} />{t('daily.pointeuses.automatic')}</label>
      <button type="button" className="ghost-button" disabled={disabled || reading} onClick={() => sync.current()}>
        {t(reading ? 'daily.pointeuses.readingButton' : 'daily.pointeuses.sync')}
      </button>
    </div>
  </section>;
}
