import { useEffect, useMemo, useRef, useState } from 'react';
import { buildAttendanceByDay, buildDailyTable, formatPointageDate, getCurrentFilePointage, prepareDailyPointage } from '../lib/dailyPointage.js';
import { loadPointageSnapshot, savePointageSnapshot } from '../services/pointageSnapshotStore';

export default function DailyPointageImport({ employees, snapshot, onSaved, loading }) {
  const rules = { dateOrder: 'dmy', breakMinutes: 0, roundingMinutes: 1, closeDays: true };
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [selectedDay, setSelectedDay] = useState('');
  const [detail, setDetail] = useState(null);
  const [listDetail, setListDetail] = useState(null);
  const listDialogRef = useRef(null);
  const dialogRef = useRef(null);
  const data = useMemo(() => getCurrentFilePointage(snapshot), [snapshot]);
  useEffect(() => {
    if (detail) dialogRef.current?.showModal();
  }, [detail]);
  useEffect(() => {
    if (listDetail) listDialogRef.current?.showModal();
  }, [listDetail]);
  function detailActions(value) {
    return { onDoubleClick: () => setListDetail(value), onKeyDown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setListDetail(value); }
    } };
  }
  const dates = useMemo(() => [...new Set((data?.rawRows || []).map((row) => row.isoDate).filter(Boolean))].sort(), [data]);
  const visibleDates = dates;
  const table = useMemo(() => buildDailyTable(data, employees, visibleDates), [data, employees, selectedDay, dates]);
  const filteredRows = table.rows.filter((row) => `${row.id} ${row.fullName}`.toLowerCase().includes(search.toLowerCase()));
  const dayLabel = formatPointageDate;
  const analysisDate = selectedDay && dates.includes(selectedDay) ? selectedDay : dates.at(-1);
  const attendance = useMemo(() => buildAttendanceByDay({ ...table, dayColumns: table.dayColumns.filter((day) => day.isoDate === analysisDate) }), [table, analysisDate]);
  const attendanceSummary = useMemo(() => {
    const day = attendance[0];
    if (!day) {
      return { present: 0, absent: 0, productionPresent: 0, productionAbsent: 0 };
    }

    return day.departments.reduce((summary, group) => {
      const isProduction = String(group.label || '').toLowerCase().startsWith('production');
      const present = Number(group.present || 0);
      const absent = Number(group.absent || 0);

      summary.present += present;
      summary.absent += absent;

      if (isProduction) {
        summary.productionPresent += present;
        summary.productionAbsent += absent;
      }

      return summary;
    }, { present: 0, absent: 0, productionPresent: 0, productionAbsent: 0 });
  }, [attendance]);
  async function importFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true); setMessage('Lecture de la base et calcul des passages…');
    try {
      const latest = await loadPointageSnapshot();
      if (!['supabase', 'remote-empty'].includes(latest.mode)) throw new Error(latest.message);
      const next = await prepareDailyPointage(file, employees, latest.data, rules);
      const info = next.importDiagnostics;
      setMessage('Sauvegarde automatique du pointage…');
      const result = await savePointageSnapshot(next);
      if (result.mode !== 'supabase') throw new Error(result.message);
      onSaved(result.data);
      setDetail(null);
      setSelectedDay('');
      setSearch('');
      const firstDay = info.incomingDates[0];
      setMessage(`Import sauvegardé en base : ${info.incomingUsable} passages lus sur ${info.incomingDates.length} journées, du ${dayLabel(firstDay)} au ${dayLabel(info.incomingDates.at(-1))} · ${info.duplicateRows} doublons ignorés · ${info.rejectedRows} lignes rejetées. Les journées précédentes sont conservées.`);
    } catch (error) { setMessage(`Import non enregistré : ${error.message} Réimportez le fichier après correction.`); }
    finally { setBusy(false); }
  }
  return <div className="daily-import">
    <div className="daily-import__actions">
      <label className="rh-import-button"><input type="file" accept=".xlsx,.xls" disabled={busy || loading || !employees.length} onChange={importFile} />{busy ? 'Traitement?' : 'Importer le fichier Excel'}</label>
      {message && <span role="status">{message}</span>}
    </div>
    {attendance.length > 0 && <section className="daily-import__attendance" aria-label="Présence par département et absences">
      <div><h2>Analyse du {dayLabel(analysisDate)}</h2><p>Services regroupés par département ; Gardiennage, Nettoyage et Projet sont séparés. Présents / actifs attendus, hors STC. Un passage à vérifier compte comme présence. Retard : première entrée après 07:30. Choisissez une date ci-dessus pour changer la journée analysée.</p></div>
      <div className="daily-import__overview" aria-label="Synthese pointage depuis la base">
        <div className="daily-import__overview-card daily-import__overview-card--present"><span>Presents</span><strong>{attendanceSummary.present}</strong><small>Base pointage</small></div>
        <div className="daily-import__overview-card daily-import__overview-card--abs"><span>Absents</span><strong>{attendanceSummary.absent}</strong><small>Base pointage</small></div>
        <div className="daily-import__overview-card daily-import__overview-card--production-present"><span>Presents production</span><strong>{attendanceSummary.productionPresent}</strong><small>Production uniquement</small></div>
        <div className="daily-import__overview-card daily-import__overview-card--production-abs"><span>Absents production</span><strong>{attendanceSummary.productionAbsent}</strong><small>Production uniquement</small></div>
      </div>
      {attendance.map((day) => <article className="rh-card daily-import__setup" key={day.isoDate}>
        <h3>{dayLabel(day.isoDate)}</h3>
        <div className="daily-import__department-grid">{day.departments.map((group) => <button type="button" className="daily-import__department daily-import__summary-card" key={group.label} {...detailActions({ title: group.label, date: day.isoDate, people: group.people })} aria-haspopup="dialog">
          <div><strong>{group.label}</strong><b>{group.percent.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %</b></div>
          <progress max="100" value={group.percent} aria-label={`Présence ${group.label}`} />
          <div className="daily-import__metrics"><span><small>Actifs</small><strong>{group.expected}</strong></span><span><small>Présents</small><strong>{group.present}</strong></span><span><small>Absents</small><strong>{group.absent}</strong></span><span><small>Retards</small><strong>{group.late}</strong></span></div>
          <div className="daily-import__kinds">{group.kinds.map((kind) => <span key={kind.label}><strong>{kind.label}</strong><b>{kind.percent.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %</b><small>{kind.present}/{kind.expected} présents · {kind.absent} ABS · {kind.late} retards</small></span>)}</div>
          {(group.review > 0 || group.unknown > 0) && <p>{group.review} à vérifier · {group.unknown} sans pointage</p>}
          <small>Double-cliquez pour voir le détail</small>
        </button>)}</div>
        {!day.departments.length && <p>Aucun actif attendu dans la base RH pour cette journée.</p>}
        <div className="daily-import__event-cards">
          <button type="button" className="daily-import__summary-card daily-import__summary-card--abs" aria-haspopup="dialog" {...detailActions({ title: 'Absents', date: day.isoDate, people: day.absences.map((person) => ({ ...person, status: 'ABS' })) })}>
            <span>Absents</span><strong>{day.absences.length}</strong><small>Double-cliquez pour voir le détail</small>
          </button>
          <button type="button" className="daily-import__summary-card daily-import__summary-card--late" aria-haspopup="dialog" {...detailActions({ title: 'Retards après 07:30', date: day.isoDate, people: day.late.map((person) => ({ ...person, status: 'Retard' })) })}>
            <span>Retards après 07:30</span><strong>{day.late.length}</strong><small>Double-cliquez pour voir le détail</small>
          </button>
        </div>
      </article>)}
    </section>}
    <article className="rh-card rh-card--table"><div className="rh-card__header rh-card__header--table"><div><h2>Pointage enregistré</h2><p>{table.dayColumns.length} journée(s) · {filteredRows.length} personne(s) · Vert : heures · Orange : à vérifier · Rouge : ABS · Bleu : STC</p></div><div className="rh-table-tools"><input aria-label="Rechercher un employé" placeholder="Nom ou matricule…" value={search} onChange={(e) => setSearch(e.target.value)} /></div></div>
      <div className="rh-table-wrap"><table className="rh-table"><thead><tr><th>ID Emp.</th><th>Nom</th><th>Département / Service</th><th>Catégorie</th>{table.dayColumns.map((d) => <th key={d.isoDate}><button type="button" className="daily-import__date-heading" aria-pressed={analysisDate === d.isoDate} onClick={() => setSelectedDay(d.isoDate)}>{dayLabel(d.isoDate)}</button></th>)}</tr></thead><tbody>{table.dayColumns.length && filteredRows.length ? filteredRows.map((r) => <tr key={r.employeeKey}><td>{r.id}</td><td>{r.fullName}</td><td>{[r.department, r.service].filter(Boolean).filter((value, index, values) => values.indexOf(value) === index).join(' / ') || '-'}</td><td>{r.kind || '-'}</td>{r.days.map((d) => <td key={d.isoDate}>{['POINTAGE', 'AVR'].includes(d.status) ? <button type="button" aria-label={`${r.fullName}, ${dayLabel(d.isoDate)} : voir l’entrée et la sortie`} className={`rh-cell-badge daily-import__time rh-cell-badge--${d.status.toLowerCase()}`} onClick={() => setDetail({ ...d, fullName: r.fullName, id: r.id })}>{d.display}</button> : <span className={`rh-cell-badge rh-cell-badge--${d.status.toLowerCase()}`}>{d.display}</span>}</td>)}</tr>) : <tr><td colSpan={4 + table.dayColumns.length} className="rh-table__empty">{!table.dayColumns.length ? 'Importez votre fichier pour créer le pointage des personnes de la base RH.' : 'Aucune personne de la base RH ne correspond à cette recherche.'}</td></tr>}</tbody></table></div>
    </article>
    {detail && <dialog ref={dialogRef} className="daily-import__dialog" aria-labelledby="punch-detail-title" onClose={() => setDetail(null)} onClick={(event) => { if (event.target === event.currentTarget) dialogRef.current.close(); }}>
      <div className="daily-import__detail">
        <div className="rh-modal__header"><div><h2 id="punch-detail-title">{detail.fullName}</h2><p>Matricule {detail.id} · {dayLabel(detail.isoDate)}</p></div><button type="button" autoFocus className="rh-modal__close" onClick={() => dialogRef.current.close()}>Fermer</button></div>
        <dl className="daily-import__punches"><div><dt>Entrée</dt><dd>{detail.entry.slice(11) || 'Non disponible'}</dd></div><div><dt>Sortie</dt><dd>{detail.exit.slice(11) || 'Manquante — à vérifier'}</dd></div></dl>
        <p>Heures calculées : <strong>{detail.status === 'POINTAGE' ? detail.display : 'À vérifier'}</strong></p>
        <p>Passages du {dayLabel(detail.isoDate)} : {detail.detail.split(' | ').map((value) => value.slice(11)).join(' · ') || 'Aucun'}</p>
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
