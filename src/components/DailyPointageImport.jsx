import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { buildAttendanceByDay, buildDailyTable, formatPointageDate, getCurrentFilePointage, prepareDailyPointage } from '../lib/dailyPointage.js';
import DailyAttendanceOverview from './DailyAttendanceOverview';
import { clearPointageSnapshot, savePointageSnapshot } from '../services/pointageSnapshotStore';
import { correctDailyPointage, verifyPointageCorrectionCode } from '../lib/pointageCorrection.js';
import PointageCorrectionForm from './PointageCorrectionForm';
import { getDefaultPointageDate, getLocalPointageDate } from '../lib/pointageDates.js';
import DashboardIcon from './DashboardIcon';

function getCurrentMonthDate() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function isExcelFile(file) {
  return /\.(xlsx|xls)$/i.test(file?.name || '');
}

function monthRangeLabel(baseMonthDate, locale) {
  const start = new Date(baseMonthDate);
  start.setMonth(start.getMonth() - 3);
  const startLabel = start.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  const endLabel = baseMonthDate.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  return `${startLabel} - ${endLabel}`;
}

function DailyPointageTopbarTools({ dates, analysisDate, onDateChange, baseMonthDate, onImport, busy, importDisabled, translate, locale }) {
  const [target, setTarget] = useState(null);

  useEffect(() => {
    setTarget(document.getElementById('daily-pointage-topbar-tools'));
  }, []);

  if (!target) return null;

  return createPortal(
    <>
      <label className="mod-period-picker mod-period-picker--topbar" htmlFor="daily-analysis-date">
        <DashboardIcon type="calendar" />
        <span>{translate('daily.importScreen.period')}</span>
        <select id="daily-analysis-date" value={analysisDate || ''} onChange={(event) => onDateChange(event.target.value)} disabled={!dates.length}>
          {!dates.length && <option value="">{translate('daily.noDays')}</option>}
          {dates.map((date) => <option key={date} value={date}>{formatPointageDate(date, locale)}</option>)}
        </select>
        <small>{monthRangeLabel(baseMonthDate, locale)}</small>
      </label>
      <label className="mod-export-button mod-export-button--topbar">
        <DashboardIcon type="upload" />
        <input type="file" accept=".xlsx,.xls" disabled={busy || importDisabled} onChange={onImport} />
        {busy ? translate('hero.importing') : translate('daily.importScreen.export')}
      </label>
    </>,
    target,
  );
}

export default function DailyPointageImport({ employees, importEmployees = employees, baseEmployees = importEmployees, snapshot, onSaved, loading, translate, locale, productionLabels, productionModTarget, onProductionModTargetChange }) {
  const rules = { dateOrder: 'mdy', breakMinutes: 0, roundingMinutes: 1, closeDays: true };
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [selectedDay, setSelectedDay] = useState('');
  const [today, setToday] = useState(getLocalPointageDate);
  const [detail, setDetail] = useState(null);
  const [correcting, setCorrecting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearCode, setClearCode] = useState('');
  const [clearError, setClearError] = useState('');
  const [listDetail, setListDetail] = useState(null);
  const listDialogRef = useRef(null);
  const dialogRef = useRef(null);
  const data = useMemo(() => getCurrentFilePointage(snapshot), [snapshot]);
  useEffect(() => {
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const timer = setTimeout(() => {
      setToday(getLocalPointageDate());
      setSelectedDay('');
    }, tomorrow - now + 1000);
    return () => clearTimeout(timer);
  }, [today]);
  useEffect(() => {
    if (detail) dialogRef.current?.showModal();
  }, [detail]);
  useEffect(() => {
    if (listDetail) listDialogRef.current?.showModal();
  }, [listDetail]);
  const dates = useMemo(() => [...new Set((data?.rawRows || []).map((row) => row.isoDate).filter(Boolean))].sort(), [data]);
  const table = useMemo(() => buildDailyTable(data, employees, dates), [data, employees, dates]);
  const dayLabel = formatPointageDate;
  const analysisDate = selectedDay && dates.includes(selectedDay) ? selectedDay : getDefaultPointageDate(dates, today);
  const filteredRows = table.rows.filter((row) =>
    `${row.id} ${row.fullName}`.toLowerCase().includes(search.toLowerCase())
    && (statusFilter === 'ALL' || row.days.some((day) => day.isoDate === analysisDate && day.status === statusFilter)));
  const baseMonthDate = useMemo(() => getCurrentMonthDate(), []);
  const attendanceHistory = useMemo(() => buildAttendanceByDay(table), [table]);
  const attendance = useMemo(() => attendanceHistory.filter((day) => day.isoDate === analysisDate), [attendanceHistory, analysisDate]);
  async function saveCorrection(correction) {
    const next = await correctDailyPointage(snapshot, importEmployees, correction);
    const result = await savePointageSnapshot(next);
    if (result.mode !== 'supabase') throw new Error(translate('daily.saveFailed'));
    onSaved(result.data);
    setDetail(null);
    setListDetail(null);
    setMessage(translate('daily.importScreen.corrected', 'Correction saved for {name} on {date}.', { name: detail.fullName, date: dayLabel(correction.isoDate) }));
  }
  async function importFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!isExcelFile(file)) {
      setMessage(translate('daily.importScreen.invalidFile'));
      return;
    }
    if (!importEmployees.length) {
      setMessage(translate('daily.importScreen.baseRequired'));
      return;
    }
    setBusy(true); setMessage(translate('daily.reading'));
    try {
      const next = await prepareDailyPointage(file, importEmployees, snapshot, rules);
      const info = next.importDiagnostics;
      setMessage(translate('daily.saving'));
      const result = await savePointageSnapshot(next);
      if (result.mode !== 'supabase') throw new Error(result.message);
      onSaved(result.data);
      setDetail(null);
      setListDetail(null);
      setSelectedDay('');
      setSearch('');
      setStatusFilter('ALL');
      const firstDay = info.incomingDates[0];
      setMessage(translate('daily.importSaved', 'Import saved: {punches} punches over {days} days, from {start} to {end} · {duplicates} duplicates skipped · {rejected} rows rejected.', {
        punches: info.incomingUsable,
        days: info.incomingDates.length,
        start: dayLabel(firstDay, locale),
        end: dayLabel(info.incomingDates.at(-1), locale),
        duplicates: info.duplicateRows,
        rejected: info.rejectedRows,
      }));
    } catch (error) {
      setMessage(translate('daily.saveFailed'));
    }
    finally { setBusy(false); }
  }
  async function clearPointage(event) {
    event.preventDefault();
    if (busy || correcting || clearing) return;
    setClearError('');
    setClearing(true);
    try {
      if (!await verifyPointageCorrectionCode(clearCode)) throw new Error(translate('daily.importScreen.incorrectCode'));
      const result = await clearPointageSnapshot();
      if (result.mode !== 'supabase') throw new Error(translate('daily.importScreen.clearFailed'));
      onSaved(null);
      setDetail(null);
      setListDetail(null);
      setSelectedDay('');
      setSearch('');
      setStatusFilter('ALL');
      setMessage(translate('daily.importScreen.cleared'));
    } catch (error) {
      setClearError(error.message || translate('daily.importScreen.clearFailed'));
    } finally {
      setClearCode('');
      setClearing(false);
    }
  }
  return <div className="daily-import">
    <DailyPointageTopbarTools
      dates={dates}
      analysisDate={analysisDate}
      onDateChange={setSelectedDay}
      baseMonthDate={baseMonthDate}
      onImport={importFile}
      busy={busy || correcting}
      importDisabled={loading || !importEmployees.length}
      translate={translate}
      locale={locale}
    />
    <DailyAttendanceOverview day={attendance[0]} history={attendanceHistory} dates={dates} analysisDate={analysisDate} onDateChange={setSelectedDay}
      baseEmployees={baseEmployees} baseMonthDate={baseMonthDate} onOpen={setListDetail}
      target={productionModTarget} onTargetChange={onProductionModTargetChange} onImport={importFile}
      busy={busy || correcting} importDisabled={loading || !importEmployees.length} message={message} translate={translate} locale={locale} productionLabels={productionLabels} />
    <article className="rh-card rh-card--table"><div className="rh-card__header rh-card__header--table"><div><h2>{translate('daily.importScreen.recorded')}</h2></div><div className="rh-table-tools">
      <input aria-label={translate('daily.importScreen.search')} placeholder={translate('daily.importScreen.nameOrId')} value={search} onChange={(e) => setSearch(e.target.value)} />
      <label className="daily-import__filter">{translate('daily.importScreen.status')}<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
        <option value="ALL">{translate('daily.importScreen.all')}</option>
        <option value="ABS">{translate('daily.importScreen.absent')}</option>
        <option value="AVR">{translate('daily.importScreen.verify')}</option>
        <option value="POINTAGE">{translate('daily.importScreen.complete')}</option>
        <option value="STC">{translate('daily.importScreen.stc')}</option>
        <option value="EMPTY">{translate('daily.importScreen.empty')}</option>
      </select></label>
      {statusFilter !== 'ALL' && <label className="daily-import__filter">{translate('daily.importScreen.forDate')}<select value={analysisDate} onChange={(event) => setSelectedDay(event.target.value)} disabled={!dates.length}>
        {dates.map((date) => <option key={date} value={date}>{dayLabel(date)}</option>)}
      </select></label>}
    </div></div>
      <div className="rh-table-wrap"><table className="rh-table"><thead><tr><th>{translate('daily.importScreen.employeeId')}</th><th>{translate('daily.importScreen.name')}</th><th>{translate('daily.importScreen.departmentService')}</th><th>{translate('daily.importScreen.category')}</th>{table.dayColumns.map((d) => <th key={d.isoDate}><button type="button" className="daily-import__date-heading" aria-pressed={analysisDate === d.isoDate} onClick={() => setSelectedDay(d.isoDate)}>{dayLabel(d.isoDate)}</button></th>)}</tr></thead><tbody>{table.dayColumns.length && filteredRows.length ? filteredRows.map((r) => <tr key={r.employeeKey}><td>{r.id}</td><td>{r.fullName}</td><td>{[r.department, r.service].filter(Boolean).filter((value, index, values) => values.indexOf(value) === index).join(' / ') || '-'}</td><td>{r.kind || '-'}</td>{r.days.map((d) => <td key={d.isoDate}>{['POINTAGE', 'AVR', 'ABS'].includes(d.status) ? <button type="button" aria-label={translate('daily.importScreen.viewPunches', '{name}, {date}: view entry and exit', { name: r.fullName, date: dayLabel(d.isoDate) })} className={`rh-cell-badge daily-import__time rh-cell-badge--${d.status.toLowerCase()}`} onClick={() => setDetail({ ...d, fullName: r.fullName, id: r.id, employeeKey: r.employeeKey })}>{d.display}</button> : <span className={`rh-cell-badge rh-cell-badge--${d.status.toLowerCase()}`}>{d.display}</span>}</td>)}</tr>) : <tr><td colSpan={4 + table.dayColumns.length} className="rh-table__empty">{!table.dayColumns.length ? translate('daily.importScreen.createData') : translate('daily.importScreen.noMatches')}</td></tr>}</tbody></table></div>
    </article>
    <form className="delete-zone" onSubmit={clearPointage}>
      <div className="delete-zone__copy">
        <strong>{translate('daily.importScreen.clearTitle')}</strong>
        <span>{translate('daily.importScreen.clearDescription')}</span>
        {clearError && <p role="alert">{clearError}</p>}
      </div>
      <div className="delete-zone__actions">
        <input className="delete-zone__input" type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder={translate('daily.importScreen.code')} value={clearCode} onChange={(event) => setClearCode(event.target.value)} disabled={busy || correcting || clearing} />
        <button className="danger-button" type="submit" disabled={busy || correcting || clearing || !clearCode.trim()}>{clearing ? translate('daily.importScreen.clearing') : translate('daily.importScreen.clear')}</button>
      </div>
    </form>
    {detail && <dialog ref={dialogRef} className="daily-import__dialog" aria-labelledby="punch-detail-title" onClose={() => setDetail(null)} onCancel={(event) => { if (correcting) event.preventDefault(); }} onClick={(event) => { if (!correcting && event.target === event.currentTarget) dialogRef.current.close(); }}>
      <div className="daily-import__detail">
        <div className="rh-modal__header"><div><h2 id="punch-detail-title">{detail.fullName}</h2><p>{translate('daily.importScreen.employeeNumber')} {detail.id} · {dayLabel(detail.isoDate)}</p></div><button type="button" autoFocus disabled={correcting} className="rh-modal__close" onClick={() => dialogRef.current.close()}>{translate('daily.importScreen.close')}</button></div>
        <dl className="daily-import__punches"><div><dt>{translate('daily.importScreen.entry')}</dt><dd>{detail.entry.slice(11) || translate('daily.unavailable')}</dd></div><div><dt>{translate('daily.importScreen.exit')}</dt><dd>{detail.exit.slice(11) || translate('daily.importScreen.missingExit')}</dd></div></dl>
        <p>{translate('daily.importScreen.calculated')} : <strong>{detail.status === 'POINTAGE' ? detail.display : detail.status === 'ABS' ? translate('daily.importScreen.absentStatus') : translate('daily.importScreen.reviewStatus')}</strong></p>
        <p>{translate('daily.importScreen.passages', 'Punches on {date}', { date: dayLabel(detail.isoDate) })} : {detail.detail.split(' | ').map((value) => value.slice(11)).join(' · ') || translate('daily.importScreen.none')}</p>
        {['POINTAGE', 'AVR', 'ABS'].includes(detail.status) && <PointageCorrectionForm key={`${detail.employeeKey}|${detail.isoDate}`} detail={detail} onSave={saveCorrection} onBusyChange={setCorrecting} disabled={busy || loading} translate={translate} />}
      </div>
    </dialog>}
    {listDetail && <dialog ref={listDialogRef} className="daily-import__dialog daily-import__dialog--list" aria-labelledby="attendance-detail-title" onClose={() => setListDetail(null)} onClick={(event) => { if (event.target === event.currentTarget) listDialogRef.current.close(); }}>
      <div className="daily-import__detail">
        <div className="rh-modal__header"><div><h2 id="attendance-detail-title">{listDetail.title}</h2><p>{dayLabel(listDetail.date)} · {translate('daily.importScreen.peopleCount', '{count} people', { count: listDetail.people.length })}</p></div><button type="button" autoFocus className="rh-modal__close" onClick={() => listDialogRef.current.close()}>{translate('daily.importScreen.close')}</button></div>
        <div className="rh-table-wrap"><table className="rh-table"><thead><tr><th>{translate('daily.importScreen.employeeId')}</th><th>{translate('daily.importScreen.name')}</th><th>{translate('table.department', 'Department')}</th><th>MOD / MOI</th><th>{translate('daily.importScreen.status')}</th><th>{translate('daily.importScreen.entry')}</th><th>{translate('daily.importScreen.late')}</th></tr></thead><tbody>{listDetail.people.length ? listDetail.people.map((person) => <tr key={person.employeeKey}><td>{person.id}</td><td>{person.fullName}</td><td>{person.department}</td><td>{person.kind}</td><td>{{ POINTAGE: translate('status.present', 'Present'), AVR: translate('status.verify', 'To verify'), EMPTY: translate('status.noData', 'No data') }[person.status] || person.status}</td><td>{person.entry || '-'}</td><td>{person.delay ? translate('daily.importScreen.minutes', '{count} min', { count: person.delay }) : '-'}</td></tr>) : <tr><td colSpan={7} className="rh-table__empty">{translate('daily.importScreen.noPeople')}</td></tr>}</tbody></table></div>
      </div>
    </dialog>}
  </div>;
}
