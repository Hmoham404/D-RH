import { useEffect, useId, useRef } from 'react'

import type {
  EmployeeDraft,
  EmployeeEditorMode,
  EmployeeFieldConfig,
  EmployeeRecord,
} from '../types/hr'

interface EmployeeEditorModalProps {
  mode: EmployeeEditorMode
  employee: EmployeeRecord | null
  draft: EmployeeDraft | null
  fields: ReadonlyArray<EmployeeFieldConfig>
  isSaving: boolean
  isDeleting: boolean
  connectionMessage: string
  contractOptions: string[]
  departmentOptions: string[]
  serviceOptions: string[]
  payTypeOptions: string[]
  deleteCode: string
  isDeleteCodeValid: boolean
  onChange: (field: keyof EmployeeDraft, value: string) => void
  onDelete: () => void
  onDeleteCodeChange: (value: string) => void
  onSave: () => void
  onClose: () => void
}

function buildFieldOptions(
  field: EmployeeFieldConfig,
  contractOptions: string[],
  departmentOptions: string[],
  serviceOptions: string[],
  payTypeOptions: string[],
) {
  const dynamicOptions = [
    ...(field.options ?? []),
    ...(field.name === 'contract' ? contractOptions : []),
    ...(field.name === 'department' ? departmentOptions : []),
    ...(field.name === 'service' ? serviceOptions : []),
    ...(field.name === 'payType' ? payTypeOptions : []),
    ...(field.name === 'signed' ? ['Oui', 'Oui/E', 'Non'] : []),
  ]

  return dynamicOptions.filter((option, index, array) => array.indexOf(option) === index)
}

export default function EmployeeEditorModal({
  mode,
  employee,
  draft,
  fields,
  isSaving,
  isDeleting,
  connectionMessage,
  contractOptions,
  departmentOptions,
  serviceOptions,
  payTypeOptions,
  deleteCode,
  isDeleteCodeValid,
  onChange,
  onDelete,
  onDeleteCodeChange,
  onSave,
  onClose,
}: EmployeeEditorModalProps) {
  const titleId = useId()
  const descriptionId = useId()
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeButtonRef.current?.focus()
  }, [])

  const modalTitle =
    mode === 'create' ? 'Nouvel employe' : employee?.fullName || 'Selectionne une personne'
  const modalDescription =
    mode === 'create'
      ? 'Remplis tous les champs utiles puis sauvegarde pour creer la fiche en base.'
      : employee
        ? 'Clique sur les champs pour consulter les donnees puis les modifier.'
        : 'Clique sur un nom dans le detail pour ouvrir sa fiche.'

  return (
    <div
      className="employee-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
    >
      <div className="employee-modal__backdrop" aria-hidden="true" onClick={onClose} />

      <article className="panel panel--employee-editor employee-modal__panel">
        <div className="employee-modal__header">
          <header className="section-title">
            <p className="eyebrow">Fiche employe</p>
            <div>
              <h2 id={titleId}>{modalTitle}</h2>
              <p id={descriptionId}>{modalDescription}</p>
            </div>
          </header>

          <button
            ref={closeButtonRef}
            className="employee-modal__close"
            type="button"
            aria-label="Fermer la fiche employe"
            onClick={onClose}
          >
            &times;
          </button>
        </div>

        {draft ? (
          <>
            <div className="employee-status-banner" role="status" aria-live="polite">
              <strong>{mode === 'create' ? 'Nouvelle fiche' : 'Fiche active'}</strong>
              <span>{connectionMessage}</span>
            </div>

            <div className="employee-summary-grid">
              <article>
                <span>Matricule</span>
                <strong>{draft.finalCode || draft.id || 'En attente'}</strong>
              </article>
              <article>
                <span>Departement</span>
                <strong>{draft.department || 'Non renseigne'}</strong>
              </article>
              <article>
                <span>Statut</span>
                <strong>{draft.status || 'Non renseigne'}</strong>
              </article>
            </div>

            <form
              onSubmit={(event) => {
                event.preventDefault()
                onSave()
              }}
            >
              <fieldset disabled={isSaving || isDeleting}>
                <div className="employee-actions">
                  <div className="editor-actions">
                    <button className="ghost-button" type="button" onClick={onClose}>
                      Fermer fiche
                    </button>
                    <button className="primary-button" type="submit" disabled={isSaving}>
                      {isSaving
                        ? 'Sauvegarde...'
                        : mode === 'create'
                          ? 'Creer la fiche'
                          : 'Mettre a jour la fiche'}
                    </button>
                  </div>
                </div>

                <div className="employee-form-grid">
                  {fields.map((field) => {
                    const fieldId = `${titleId}-${String(field.name)}`
                    const options = buildFieldOptions(
                      field,
                      contractOptions,
                      departmentOptions,
                      serviceOptions,
                      payTypeOptions,
                    )

                    return (
                      <label className="employee-field" key={String(field.name)} htmlFor={fieldId}>
                        <span>{field.label}</span>
                        {field.type === 'select' ? (
                          <select
                            id={fieldId}
                            value={draft[field.name] ?? ''}
                            disabled={field.name === 'service' && !serviceOptions.length}
                            onChange={(event) => onChange(field.name, event.target.value)}
                          >
                            {options.map((option) => (
                              <option key={option || 'empty'} value={option}>
                                {option || (field.name === 'service' ? 'Choisir un service' : 'Vide')}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            id={fieldId}
                            type="text"
                            value={draft[field.name] ?? ''}
                            onChange={(event) => onChange(field.name, event.target.value)}
                          />
                        )}
                        {mode === 'create' && field.autoGenerated ? (
                          <small>Pre-rempli automatiquement en serie +1, mais modifiable.</small>
                        ) : null}
                      </label>
                    )
                  })}
                </div>
              </fieldset>
            </form>

            {mode === 'edit' ? (
              <div className="delete-zone">
                <div className="delete-zone__copy">
                  <strong>Supprimer cette fiche</strong>
                  <span>Entre le code `123` ou `MYC` pour autoriser la suppression.</span>
                </div>
                <div className="delete-zone__actions">
                  <input
                    className="delete-zone__input"
                    type="password"
                    value={deleteCode}
                    placeholder="Code 123 ou MYC"
                    onChange={(event) => onDeleteCodeChange(event.target.value)}
                  />
                  <button
                    className="danger-button"
                    type="button"
                    onClick={onDelete}
                    disabled={isDeleting || !isDeleteCodeValid}
                  >
                    {isDeleting ? 'Suppression...' : 'Supprimer la fiche'}
                  </button>
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <div className="detail-empty">
            Ouvre une personne pour voir ses donnees, les modifier, puis les enregistrer.
          </div>
        )}
      </article>
    </div>
  )
}
