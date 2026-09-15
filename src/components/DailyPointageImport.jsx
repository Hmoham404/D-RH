import { useEffect, useMemo, useRef, useState } from 'react';
import { buildAttendanceByDay, buildDailyTable, formatPointageDate, getCurrentFilePointage, prepareDailyPointage } from '../lib/dailyPointage.js';
import DailyAttendanceOverview from './DailyAttendanceOverview';
import { replacePointageSnapshot, savePointageSnapshot } from '../services/pointageSnapshotStore';
import { correctDailyPointage } from '../lib/pointageCorrection.js';
import PointageCorrectionForm from './PointageCorrectionForm';
import { getDefaultPointageDate, getLocalPointageDate } from '../lib/pointageDates.js';

function getCurrentMonthDate() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export default function DailyPointageImport({ employees, baseEmployees = employees, snapshot, onSaved, loading, translate, locale, productionLabels, productionModTarget, onProductionModTargetChange }) {
  const rules = { dateOrder: 'mdy', breakMinutes: 0, roundingMinutes: 1, closeDays: true };
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [selectedDay, setSelectedDay] = useState('');
  const [today, setToday] = useState(getLocalPointageDate);
  const [detail, setDetail] = useState(null);
  const [correcting, setCorrecting] = useState(false);
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
    const next = await correctDailyPointage(snapshot, employees, correction);
    const result = await savePointageSnapshot(next);
    if (result.mode !== 'supabase') throw new Error(result.message);
    onSaved(result.data);
    setDetail(null);
    setListDetail(null);
    setMessage(`Correction RH enregistrée pour ${detail.fullName}, le ${dayLabel(correction.isoDate)}. Les heures et les indicateurs ont été recalculés.`);
  }
  async function importFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true); setMessage('Lecture de la base et calcul des passages…');
    try {
      const next = await prepareDailyPointage(file, employees, null, rules);
      const info = next.importDiagnostics;
      setMessage('Sauvegarde automatique du pointage…');
      const result = await replacePointageSnapshot(next);
      if (result.mode !== 'supabase') throw new Error(result.message);
      onSaved(result.data);
      setDetail(null);
      setListDetail(null);
      setSelectedDay('');
      setSearch('');
      setStatusFilter('ALL');
      const firstDay = info.incomingDates[0];
      setMessage(`Import sauvegardé : ${info.incomingUsable} passages sur ${info.incomingDates.length} journées, du ${dayLabel(firstDay)} au ${dayLabel(info.incomingDates.at(-1))} · ${info.duplicateRows} doublons ignorés · ${info.rejectedRows} lignes rejetées. ${result.message}`);
    } catch (error) { setMessage(`Import non enregistré : ${error.message} Réimportez le fichier après correction.`); }
    finally { setBusy(false); }
  }
  return <div className="daily-import">
    <DailyAttendanceOverview day={attendance[0]} history={attendanceHistory} dates={dates} analysisDate={analysisDate} onDateChange={setSelectedDay}
      baseEmployees={baseEmployees} baseMonthDate={baseMonthDate} onOpen={setListDetail}
      target={productionModTarget} onTargetChange={onProductionModTargetChange} onImport={importFile}
      busy={busy || correcting} importDisabled={loading || !employees.length} message={message} translate={translate} locale={locale} productionLabels={productionLabels} />
    <article className="rh-card rh-card--table"><div className="rh-card__header rh-card__header--table"><div><h2>Pointage enregistré</h2></div><div className="rh-table-tools">
      <input aria-label="Rechercher un employé" placeholder="Nom ou matricule…" value={search} onChange={(e) => setSearch(e.target.value)} />
      <label className="daily-import__filter">Statut<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
        <option value="ALL">Tous les statuts</option>
        <option value="ABS">ABS uniquement</option>
        <option value="AVR">À vérifier</option>
        <option value="POINTAGE">Pointages complets</option>
        <option value="STC">STC uniquement</option>
        <option value="EMPTY">Sans pointage</option>
      </select></label>
      {statusFilter !== 'ALL' && <label className="daily-import__filter">Pour le<select value={analysisDate} onChange={(event) => setSelectedDay(event.target.value)} disabled={!dates.length}>
        {dates.map((date) => <option key={date} value={date}>{dayLabel(date)}</option>)}
      </select></label>}
    </div></div>
      <div className="rh-table-wrap"><table className="rh-table"><thead><tr><th>ID Emp.</th><th>Nom</th><th>Département / Service</th><th>Catégorie</th>{table.dayColumns.map((d) => <th key={d.isoDate}><button type="button" className="daily-import__date-heading" aria-pressed={analysisDate === d.isoDate} onClick={() => setSelectedDay(d.isoDate)}>{dayLabel(d.isoDate)}</button></th>)}</tr></thead><tbody>{table.dayColumns.length && filteredRows.length ? filteredRows.map((r) => <tr key={r.employeeKey}><td>{r.id}</td><td>{r.fullName}</td><td>{[r.department, r.service].filter(Boolean).filter((value, index, values) => values.indexOf(value) === index).join(' / ') || '-'}</td><td>{r.kind || '-'}</td>{r.days.map((d) => <td key={d.isoDate}>{['POINTAGE', 'AVR', 'ABS'].includes(d.status) ? <button type="button" aria-label={`${r.fullName}, ${dayLabel(d.isoDate)} : voir l’entrée et la sortie`} className={`rh-cell-badge daily-import__time rh-cell-badge--${d.status.toLowerCase()}`} onClick={() => setDetail({ ...d, fullName: r.fullName, id: r.id, employeeKey: r.employeeKey })}>{d.display}</button> : <span className={`rh-cell-badge rh-cell-badge--${d.status.toLowerCase()}`}>{d.display}</span>}</td>)}</tr>) : <tr><td colSpan={4 + table.dayColumns.length} className="rh-table__empty">{!table.dayColumns.length ? 'Importez votre fichier pour créer le pointage des personnes de la base RH.' : 'Aucune personne de la base RH ne correspond à cette recherche.'}</td></tr>}</tbody></table></div>
    </article>
    {detail && <dialog ref={dialogRef} className="daily-import__dialog" aria-labelledby="punch-detail-title" onClose={() => setDetail(null)} onCancel={(event) => { if (correcting) event.preventDefault(); }} onClick={(event) => { if (!correcting && event.target === event.currentTarget) dialogRef.current.close(); }}>
      <div className="daily-import__detail">
        <div className="rh-modal__header"><div><h2 id="punch-detail-title">{detail.fullName}</h2><p>Matricule {detail.id} · {dayLabel(detail.isoDate)}</p></div><button type="button" autoFocus disabled={correcting} className="rh-modal__close" onClick={() => dialogRef.current.close()}>Fermer</button></div>
        <dl className="daily-import__punches"><div><dt>Entrée</dt><dd>{detail.entry.slice(11) || 'Non disponible'}</dd></div><div><dt>Sortie</dt><dd>{detail.exit.slice(11) || 'Manquante — à vérifier'}</dd></div></dl>
        <p>Heures calculées : <strong>{detail.status === 'POINTAGE' ? detail.display : detail.status === 'ABS' ? 'Absent' : 'À vérifier'}</strong></p>
        <p>Passages du {dayLabel(detail.isoDate)} : {detail.detail.split(' | ').map((value) => value.slice(11)).join(' · ') || 'Aucun'}</p>
        {['POINTAGE', 'AVR', 'ABS'].includes(detail.status) && <PointageCorrectionForm key={`${detail.employeeKey}|${detail.isoDate}`} detail={detail} onSave={saveCorrection} onBusyChange={setCorrecting} disabled={busy || loading} />}
      </div>
    </dialog>}
    {listDetail && <dialog ref={listDialogRef} className="daily-import__dialog daily-import__dialog--list" aria-labelledby="attendance-detail-title" onClose={() => setListDetail(null)} onClick={(event) => { if (event.target === event.currentTarget) listDialogRef.current.close(); }}>
      <div className="daily-import__detail">
        <div className="rh-modal__header"><div><h2 id="attendance-detail-title">{listDetail.title}</h2><p>{dayLabel(listDetail.date)} · {listDetail.people.length} personne(s)</p></div><button type="button" autoFocus className="rh-modal__close" onClick={() => listDialogRef.current.close()}>Fermer</button></div>
        <div className="rh-table-wrap"><table className="rh-table"><thead><tr><th>ID Emp.</th><th>Nom</th><th>Département</th><th>MOD / MOI</th><th>Statut</th><th>Entrée</th><th>Retard</th></tr></thead><tbody>{listDetail.people.length ? listDetail.people.map((person) => <tr key={person.employeeKey}><td>{person.id}</td><td>{person.fullName}</td><td>{person.department}</td><td>{person.kind}</td><td>{{ POINTAGE: 'Présent', AVR: 'À vérifier', EMPTY: 'Sans pointage' }[person.status] || person.status}</td><td>{person.entry || '-'}</td><td>{person.delay ? `${person.delay} min` : '-'}</td></tr>) : <tr><td colSpan={7} className="rh-table__empty">Aucune personne pour cette journée.</td></tr>}</tbody></table></div>
      </div>
    </dialog>}
  </div>;
}
