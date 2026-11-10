import { useState } from 'react';
import { verifyPointageCorrectionCode } from '../lib/pointageCorrection.js';
import { POINTAGE_CORRECTION_CHOICES, pointageStatusLabel } from '../lib/pointageStatus.js';

export default function PointageCorrectionForm({ detail, onSave, onBusyChange, disabled, translate, breakMinutes = 24, defaultBreakMinutes = breakMinutes }) {
  const [status, setStatus] = useState(POINTAGE_CORRECTION_CHOICES.includes(detail.status) ? detail.status : 'POINTAGE');
  const [entry, setEntry] = useState(detail.entry?.slice(11, 16) || '');
  const [exit, setExit] = useState(detail.exit?.slice(11, 16) || '');
  const [pause, setPause] = useState(Number(['POINTAGE', 'AVR'].includes(detail.status) ? breakMinutes : defaultBreakMinutes));
  const [accessCode, setAccessCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault();
    if (saving || disabled) return;
    setError('');
    setSaving(true);
    onBusyChange(true);
    try {
      if (!await verifyPointageCorrectionCode(accessCode)) throw new Error(translate('daily.importScreen.incorrectCode'));
      await onSave({ employeeKey: detail.employeeKey, isoDate: detail.isoDate, status,
        entry: status === 'POINTAGE' ? entry : '', exit: status === 'POINTAGE' ? exit : '',
        breakMinutes: status === 'POINTAGE' ? pause : 0 });
    } catch (cause) {
      setError(cause?.message || translate('daily.importScreen.correctionError'));
    } finally {
      setAccessCode('');
      setSaving(false);
      onBusyChange(false);
    }
  }
  return <form className="pointage-correction" onSubmit={submit}>
    <h3>{translate('daily.importScreen.correctionTitle')}</h3>
    <p>{translate('daily.importScreen.statusCorrectionHelp', 'Choisissez une présence, une absence ou un motif de congé / repos pour cette journée.')}</p>
    <fieldset disabled={saving || disabled}>
      <label>{translate('daily.importScreen.statusCorrectionLabel', 'Statut de la journée')}
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          {POINTAGE_CORRECTION_CHOICES.map((choice) => <option key={choice} value={choice}>{pointageStatusLabel(choice, translate)}</option>)}
        </select>
      </label>
      {status === 'POINTAGE' ? <>
      <div className="pointage-correction__hours">
        <label>{translate('daily.importScreen.entry')}<input type="text" inputMode="text" autoComplete="off" placeholder="07:30 ou 5:30 PM" aria-label={`${translate('daily.importScreen.entry')} (24 h ou AM/PM)`} required={!exit} value={entry} onChange={(event) => setEntry(event.target.value)} /></label>
        <label>{translate('daily.importScreen.exit')}<input type="text" inputMode="text" autoComplete="off" placeholder="17:00 ou 5:00 PM" aria-label={`${translate('daily.importScreen.exit')} (24 h ou AM/PM)`} required={!entry} value={exit} onChange={(event) => setExit(event.target.value)} /></label>
      </div>
      <label>{translate('daily.importScreen.breakCorrectionLabel', 'Pause déduite (min)')}<input aria-label={translate('daily.importScreen.breakCorrectionLabel', 'Pause déduite (min)')} type="number" min="0" max="180" step="1" required value={pause} onChange={(event) => {
        const value = Number(event.target.value);
        if (event.target.value !== '' && Number.isFinite(value) && value >= 0 && value <= 180) setPause(value);
      }} /></label>
      <small>{translate('daily.importScreen.breakCorrectionHelp', 'Cette durée s’applique à cette personne et à cette journée uniquement.')}</small>
      <small>{translate('daily.importScreen.singlePunch')}</small>
      </> : <small className="pointage-correction__status-help">{status === 'ABS'
        ? translate('daily.importScreen.absenceCorrectionHelp', 'Cette journée reste comptée dans les ABS.')
        : translate('daily.importScreen.justifiedCorrectionHelp', 'Ce motif retire cette journée du compteur ABS, sans ajouter de présence ni d’heures travaillées.')}</small>}
      <label>{translate('daily.importScreen.code')}<input type="password" required autoComplete="off" autoCapitalize="none" spellCheck={false} value={accessCode} onChange={(event) => setAccessCode(event.target.value)} aria-describedby="rh-code-help" /></label>
      <small id="rh-code-help">{translate('daily.importScreen.codeHelp')}</small>
      <button type="submit" className="rh-import-button">{saving ? translate('daily.importScreen.savingCorrection') : translate('daily.importScreen.saveCorrection')}</button>
    </fieldset>
    {error && <p className="pointage-correction__error" role="alert">{error}</p>}
  </form>;
}
