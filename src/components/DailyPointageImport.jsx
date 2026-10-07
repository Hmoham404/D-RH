import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as XLSX from 'xlsx';
import { buildAttendanceByDay, buildDailyTable, formatPointageDate, getCurrentFilePointage, normalizeSavedPointageSnapshot, prepareDailyPointage } from '../lib/dailyPointage.js';
import DailyAttendanceOverview from './DailyAttendanceOverview';
import { clearPointageSnapshot, savePointageSnapshot } from '../services/pointageSnapshotStore';
import { correctDailyPointage, verifyPointageCorrectionCode } from '../lib/pointageCorrection.js';
import PointageCorrectionForm from './PointageCorrectionForm';
import { getDefaultPointageDate, getLocalPointageDate } from '../lib/pointageDates.js';
import DashboardIcon from './DashboardIcon';

function isExcelFile(file) {
  return /\.(xlsx|xls)$/i.test(file?.name || '');
}

function monthRangeLabel(anchorIsoDate, locale) {
  const anchor = anchorIsoDate ? new Date(`${anchorIsoDate}T12:00:00`) : new Date();
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), 26);
  if (anchor.getDate() < 26) start.setMonth(start.getMonth() - 1);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 25);
  const format = (date) => date.toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' });
  return `${format(start)} - ${format(end)}`;
}

function getWeekStart(isoDate) {
  if (!isoDate) return '';
  const date = new Date(`${isoDate}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return '';
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}

function weekRangeLabel(weekStart, locale) {
  const start = new Date(`${weekStart}T12:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const format = (date) => date.toLocaleDateString(locale, { day: '2-digit', month: 'short', timeZone: 'UTC' });
  return `${format(start)} – ${format(end)}`;
}

function DailyPointageTopbarTools({ dates, analysisDate, onDateChange, onImport, busy, importDisabled, translate, locale }) {
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
        <small>{monthRangeLabel(analysisDate, locale)}</small>
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

export default function DailyPointageImport({ employees, importEmployees = employees, baseEmployees = importEmployees, selectedDate = '', onDateChange, snapshot, onSaved, loading, translate, locale, productionLabels, productionModTarget, onProductionModTargetChange, pointageBreakMinutes = 24, onPointageBreakMinutesChange }) {
  const rules = { dateOrder: 'mdy', breakMinutes: pointageBreakMinutes, roundingMinutes: 1, closeDays: true };
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
  function changeAnalysisDate(value) {
    setSelectedDay(value);
    onDateChange?.(value);
  }
  useEffect(() => {
    if (!snapshot || loading || Number(snapshot.calculationRules?.breakMinutes ?? snapshot.currentFilePointage?.calculationRules?.breakMinutes) === pointageBreakMinutes) return;
    let cancelled = false;
    async function recalculateSavedPointage() {
      setBusy(true);
      try {
        const updated = await normalizeSavedPointageSnapshot(snapshot, importEmployees, pointageBreakMinutes);
        if (cancelled || !updated) return;
        const result = await savePointageSnapshot(updated, { expectedUpdatedAt: snapshot.storageRevision });
        if (cancelled) return;
        if (result.mode !== 'supabase') throw new Error(result.message);
        onSaved(result.data || updated);
        setMessage(translate('daily.importScreen.breakSaved', 'Pause mise à {minutes} min : le pointage a été recalculé et enregistré.', { minutes: pointageBreakMinutes }));
      } catch (error) {
        if (!cancelled) setMessage(error.message || translate('daily.importScreen.breakSaveFailed', 'Impossible d’enregistrer le nouveau calcul de pause.'));
      } finally {
        if (!cancelled) setBusy(false);
      }
    }
    recalculateSavedPointage();
    return () => { cancelled = true; };
  }, [pointageBreakMinutes, snapshot, importEmployees, loading]);
  useEffect(() => {
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const timer = setTimeout(() => {
      setToday(getLocalPointageDate());
      changeAnalysisDate('');
    }, tomorrow - now + 1000);
    return () => clearTimeout(timer);
  }, [today]);
  useEffect(() => {
    if (detail) dialogRef.current?.showModal();
  }, [detail]);
  useEffect(() => {
    if (listDetail) listDialogRef.current?.showModal();
  }, [listDetail]);
  const dates = useMemo(() => [...new Set([
    ...(data?.rawRows || []).map((row) => row.isoDate),
    ...(data?.sourceWeeklySheets || []).flatMap((sheet) => sheet.dayColumns.map((day) => day.isoDate)),
  ].filter(Boolean))].sort(), [data]);
  const table = useMemo(() => buildDailyTable(data, importEmployees, dates), [data, importEmployees, dates]);
  const dayLabel = formatPointageDate;
  const requestedDate = selectedDate || selectedDay;
  const analysisDate = requestedDate && dates.includes(requestedDate) ? requestedDate : getDefaultPointageDate(dates, today);
  const weeks = useMemo(() => {
    const grouped = new Map();
    table.dayColumns.forEach((day) => {
      const start = getWeekStart(day.isoDate);
      if (!grouped.has(start)) grouped.set(start, []);
      grouped.get(start).push(day);
    });
    return [...grouped.entries()].map(([start, days]) => ({ start, days }));
  }, [table.dayColumns]);
  const activeWeek = weeks.find((week) => week.start === getWeekStart(analysisDate)) || weeks.at(-1);
  const visibleDayColumns = activeWeek?.days || table.dayColumns;
  const visibleDates = useMemo(() => new Set(visibleDayColumns.map((day) => day.isoDate)), [visibleDayColumns]);
  const filteredRows = table.rows.filter((row) =>
    `${row.id} ${row.fullName}`.toLowerCase().includes(search.toLowerCase())
    && (statusFilter === 'ALL' || row.days.some((day) => day.isoDate === analysisDate && day.status === statusFilter)));
  function downloadAttendanceExcel() {
    const headers = [
      translate('daily.importScreen.employeeId'),
      translate('daily.importScreen.name'),
      translate('daily.importScreen.departmentService'),
      translate('daily.importScreen.category'),
      ...table.dayColumns.map((day) => dayLabel(day.isoDate, locale)),
    ];
    const dailyTotals = [
      '', '', '', '',
      ...table.dayColumns.map((column) => {
        const cells = table.rows.map((row) => row.days.find((day) => day.isoDate === column.isoDate)).filter(Boolean);
        const presentCount = cells.filter((day) => ['POINTAGE', 'AVR'].includes(day.status)).length;
        const absentCount = cells.filter((day) => day.status === 'ABS').length;
        return `${translate('kpi.presents', 'Presents')}: ${presentCount} · ${translate('kpi.absents', 'Absents')}: ${absentCount}`;
      }),
    ];
    const rows = filteredRows.map((row) => [
      row.id,
      row.fullName,
      [row.department, row.service].filter(Boolean).filter((value, index, values) => values.indexOf(value) === index).join(' / ') || '-',
      row.kind || '-',
      ...row.days.map((day) => day.display || '-'),
    ]);
    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows, dailyTotals]);
    worksheet['!cols'] = [
      { wch: 14 }, { wch: 30 }, { wch: 34 }, { wch: 14 },
      ...table.dayColumns.map(() => ({ wch: 22 })),
    ];
    if (headers.length) worksheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: headers.length - 1 } }) };
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Pointage');
    XLSX.writeFile(workbook, `pointage_${analysisDate || today}.xlsx`);
  }
  const attendanceHistory = useMemo(() => buildAttendanceByDay(table), [table]);
  const baseMonthDate = useMemo(() => new Date(`${analysisDate || today}T12:00:00`), [analysisDate, today]);
  const attendance = useMemo(() => attendanceHistory.filter((day) => day.isoDate === analysisDate), [attendanceHistory, analysisDate]);
  async function saveCorrection(correction) {
    const next = await correctDailyPointage(snapshot, importEmployees, correction);
    const result = await savePointageSnapshot(next, { expectedUpdatedAt: snapshot.storageRevision });
    if (result.mode !== 'supabase') throw new Error(result.message || translate('daily.saveFailed'));
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
    setBusy(true); setMessage(translate('daily.reading'));
    try {
      const next = await prepareDailyPointage(file, importEmployees, snapshot, rules);
      const info = next.importDiagnostics;
      setMessage(translate('daily.saving'));
      const result = await savePointageSnapshot(next);
      if (result.mode !== 'supabase') throw new Error(result.message);
      onSaved(result.data, { resetSelectedDate: true });
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
      setMessage(error.message || translate('daily.saveFailed'));
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
      onDateChange={changeAnalysisDate}
      onImport={importFile}
      busy={busy || correcting}
      importDisabled={loading}
      translate={translate}
      locale={locale}
    />
    <DailyAttendanceOverview day={attendance[0]} history={attendanceHistory} dates={dates} analysisDate={analysisDate} onDateChange={changeAnalysisDate}
      baseEmployees={baseEmployees} baseMonthDate={baseMonthDate} onOpen={setListDetail}
      target={productionModTarget} onTargetChange={onProductionModTargetChange} onImport={importFile}
      busy={busy || correcting} importDisabled={loading} message={message} translate={translate} locale={locale} productionLabels={productionLabels} />
    <article className="rh-card rh-card--table"><div className="rh-card__header rh-card__header--table"><div><h2>{translate('daily.importScreen.recorded')}</h2></div><div className="rh-table-tools">
      <section className="daily-break-setting daily-break-setting--inline" aria-label={translate('daily.importScreen.breakSetting', 'Temps de pause')}>
        <div><strong>{translate('daily.importScreen.breakSetting', 'Temps de pause')}</strong><span>{translate('daily.importScreen.breakDescription', 'Durée déduite des heures calculées')}</span></div>
        <div className="daily-break-setting__controls">
          {[24, 30].map((minutes) => <button key={minutes} type="button" className={pointageBreakMinutes === minutes ? 'is-selected' : ''} aria-pressed={pointageBreakMinutes === minutes} onClick={() => onPointageBreakMinutesChange?.(minutes)} disabled={busy || loading}>{minutes} min</button>)}
          <label><span>{translate('daily.importScreen.customBreak', 'Autre')}</span><input aria-label={translate('daily.importScreen.customBreak', 'Autre durée de pause')} type="number" min="0" max="180" step="1" value={pointageBreakMinutes} onChange={(event) => {
            const value = Number(event.target.value);
            if (event.target.value !== '' && Number.isFinite(value) && value >= 0 && value <= 180) onPointageBreakMinutesChange?.(value);
          }} disabled={busy || loading} /><span>min</span></label>
        </div>
        {snapshot && Number(snapshot.calculationRules?.breakMinutes ?? snapshot.currentFilePointage?.calculationRules?.breakMinutes) !== pointageBreakMinutes && <small role="status">{translate('daily.importScreen.recalculatingBreak', 'Recalcul et sauvegarde du pointage en cours…')}</small>}
      </section>
      <input aria-label={translate('daily.importScreen.search')} placeholder={translate('daily.importScreen.nameOrId')} value={search} onChange={(e) => setSearch(e.target.value)} />
      <label className="daily-import__filter">{translate('daily.importScreen.status')}<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
        <option value="ALL">{translate('daily.importScreen.all')}</option>
        <option value="ABS">{translate('daily.importScreen.absent')}</option>
        <option value="AVR">{translate('daily.importScreen.verify')}</option>
        <option value="POINTAGE">{translate('daily.importScreen.complete')}</option>
        <option value="STC">{translate('daily.importScreen.stc')}</option>
        <option value="EMPTY">{translate('daily.importScreen.empty')}</option>
      </select></label>
      <button type="button" className="daily-import__download-button" onClick={downloadAttendanceExcel} disabled={!table.dayColumns.length}>
        <DashboardIcon type="download" />{translate('daily.importScreen.downloadExcel', 'Télécharger Excel')}
      </button>
      {statusFilter !== 'ALL' && <label className="daily-import__filter">{translate('daily.importScreen.forDate')}<select value={analysisDate} onChange={(event) => changeAnalysisDate(event.target.value)} disabled={!dates.length}>
        {dates.map((date) => <option key={date} value={date}>{dayLabel(date)}</option>)}
      </select></label>}
    </div></div>
      <div className="daily-import__week-bar">
        <strong>{activeWeek ? `${translate('daily.week', 'Semaine')} · ${weekRangeLabel(activeWeek.start, locale)}` : translate('daily.noDays')}</strong>
        <label className="daily-import__filter">{translate('daily.week', 'Semaine')}<select value={activeWeek?.start || ''} onChange={(event) => {
          const week = weeks.find((item) => item.start === event.target.value);
          if (week?.days[0]) changeAnalysisDate(week.days[0].isoDate);
        }} disabled={!weeks.length}>
          {weeks.map((week) => <option key={week.start} value={week.start}>{weekRangeLabel(week.start, locale)}</option>)}
        </select></label>
      </div>
      <div className="rh-table-wrap"><table className="rh-table"><thead><tr><th>{translate('daily.importScreen.employeeId')}</th><th>{translate('daily.importScreen.name')}</th><th>{translate('daily.importScreen.departmentService')}</th><th>{translate('daily.importScreen.category')}</th>{visibleDayColumns.map((d) => {
        const dayRows = table.rows.map((row) => row.days.find((day) => day.isoDate === d.isoDate)).filter(Boolean);
        const presentCount = dayRows.filter((day) => ['POINTAGE', 'AVR'].includes(day.status)).length;
        const absentCount = dayRows.filter((day) => day.status === 'ABS').length;
        return <th key={d.isoDate}><button type="button" className="daily-import__date-heading" aria-pressed={analysisDate === d.isoDate} onClick={() => changeAnalysisDate(d.isoDate)}><span>{dayLabel(d.isoDate)}</span><small>{translate('kpi.presents', 'Presents')}: {presentCount} · {translate('kpi.absents', 'Absents')}: {absentCount}</small></button></th>;
       })}</tr></thead><tbody>{visibleDayColumns.length && filteredRows.length ? filteredRows.map((r) => <tr key={r.employeeKey}><td>{r.id}</td><td>{r.fullName}</td><td>{[r.department, r.service].filter(Boolean).filter((value, index, values) => values.indexOf(value) === index).join(' / ') || '-'}</td><td>{r.kind || '-'}</td>{r.days.filter((day) => visibleDates.has(day.isoDate)).map((d) => <td key={d.isoDate}>{['POINTAGE', 'AVR', 'ABS'].includes(d.status) ? <button type="button" aria-label={translate('daily.importScreen.viewPunches', '{name}, {date}: view entry and exit', { name: r.fullName, date: dayLabel(d.isoDate) })} className={`rh-cell-badge daily-import__time rh-cell-badge--${d.status.toLowerCase()}`} onClick={() => setDetail({ ...d, fullName: r.fullName, id: r.id, employeeKey: r.employeeKey })}>{d.display}</button> : <span className={`rh-cell-badge rh-cell-badge--${d.status.toLowerCase()}`}>{d.display}</span>}</td>)}</tr>) : <tr><td colSpan={4 + visibleDayColumns.length} className="rh-table__empty">{!table.dayColumns.length ? translate('daily.importScreen.createData') : translate('daily.importScreen.noMatches')}</td></tr>}</tbody></table></div>
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
        {['POINTAGE', 'AVR', 'ABS'].includes(detail.status) && <PointageCorrectionForm key={`${detail.employeeKey}|${detail.isoDate}`} detail={detail} breakMinutes={detail.breakMinutes ?? data?.calculationRules?.breakOverrides?.[`${detail.employeeKey}|${detail.isoDate}`] ?? data?.calculationRules?.breakMinutes ?? pointageBreakMinutes} onSave={saveCorrection} onBusyChange={setCorrecting} disabled={busy || loading} translate={translate} />}
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
