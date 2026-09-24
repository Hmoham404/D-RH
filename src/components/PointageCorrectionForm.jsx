import { useState } from 'react';
import { verifyPointageCorrectionCode } from '../lib/pointageCorrection.js';

export default function PointageCorrectionForm({ detail, onSave, onBusyChange, disabled, translate }) {
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
      if (!await verifyPointageCorrectionCode(accessCode)) throw new Error(translate('daily.importScreen.incorrectCode'));
      await onSave({ employeeKey: detail.employeeKey, isoDate: detail.isoDate, entry, exit });
    } catch (cause) {
      setError(translate('daily.importScreen.correctionError'));
    } finally {
      setAccessCode('');
      setSaving(false);
      onBusyChange(false);
    }
  }
  return <form className="pointage-correction" onSubmit={submit}>
    <h3>{translate('daily.importScreen.correctionTitle')}</h3>
    <p>{detail.status === 'ABS' ? translate('daily.importScreen.absentCorrection') : translate('daily.importScreen.completeCorrection')}</p>
    <fieldset disabled={saving || disabled}>
      <div className="pointage-correction__hours">
        <label>{translate('daily.importScreen.entry')}<input type="time" required={!exit} value={entry} onChange={(event) => setEntry(event.target.value)} /></label>
        <label>{translate('daily.importScreen.exit')}<input type="time" required={!entry} value={exit} onChange={(event) => setExit(event.target.value)} /></label>
      </div>
      <small>{translate('daily.importScreen.singlePunch')}</small>
      <label>{translate('daily.importScreen.code')}<input type="password" required autoComplete="off" autoCapitalize="none" spellCheck={false} value={accessCode} onChange={(event) => setAccessCode(event.target.value)} aria-describedby="rh-code-help" /></label>
      <small id="rh-code-help">{translate('daily.importScreen.codeHelp')}</small>
      <button type="submit" className="rh-import-button">{saving ? translate('daily.importScreen.savingCorrection') : translate('daily.importScreen.saveCorrection')}</button>
    </fieldset>
    {error && <p className="pointage-correction__error" role="alert">{error}</p>}
  </form>;
}
