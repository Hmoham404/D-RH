import { useState } from 'react';
import { verifyPointageCorrectionCode } from '../lib/pointageCorrection.js';

export default function PointageCorrectionForm({ detail, onSave, onBusyChange, disabled }) {
  const [entry, setEntry] = useState(detail.entry?.slice(11, 16) || '');
  const [exit, setExit] = useState(detail.exit?.slice(11, 16) || '');
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
      if (!await verifyPointageCorrectionCode(accessCode)) throw new Error('Code RH incorrect.');
      await onSave({ employeeKey: detail.employeeKey, isoDate: detail.isoDate, entry, exit });
    } catch (cause) {
      setError(cause.message || 'La correction n’a pas pu être enregistrée.');
    } finally {
      setAccessCode('');
      setSaving(false);
      onBusyChange(false);
    }
  }
  return <form className="pointage-correction" onSubmit={submit}>
    <h3>Correction RH</h3>
    <p>{detail.status === 'ABS' ? 'Renseignez les heures pour remplacer l’absence par une présence.' : 'Vérifiez et complétez les heures de cette journée.'}</p>
    <fieldset disabled={saving || disabled}>
      <div className="pointage-correction__hours">
        <label>Heure d’entrée<input type="time" required={!exit} value={entry} onChange={(event) => setEntry(event.target.value)} /></label>
        <label>Heure de sortie<input type="time" required={!entry} value={exit} onChange={(event) => setExit(event.target.value)} /></label>
      </div>
      <small>Une seule heure suffit : le pointage restera impair, à vérifier. Avec deux heures, la sortie doit être après l’entrée, dans la même journée.</small>
      <label>Code RH<input type="password" required autoComplete="off" autoCapitalize="none" spellCheck={false} value={accessCode} onChange={(event) => setAccessCode(event.target.value)} aria-describedby="rh-code-help" /></label>
      <small id="rh-code-help">Saisissez votre code RH pour enregistrer la correction.</small>
      <button type="submit" className="rh-import-button">{saving ? 'Enregistrement…' : 'Enregistrer la correction'}</button>
    </fieldset>
    {error && <p className="pointage-correction__error" role="alert">{error}</p>}
  </form>;
}
