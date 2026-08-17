import { useId } from 'react'

import type { DetailSelection, EmployeeRecord } from '../types/hr'

interface DetailPanelProps {
  detail: DetailSelection
  activeRecordId: string | null
  searchValue: string
  onSearchChange: (value: string) => void
  onSearchClear: () => void
  onPersonClick?: (employee: EmployeeRecord) => void
}

export default function DetailPanel({
  detail,
  activeRecordId,
  searchValue,
  onSearchChange,
  onSearchClear,
  onPersonClick,
}: DetailPanelProps) {
  const searchId = useId()
  const resultsId = useId()
  const helperText = `${detail.items.length} nom(s) trouves sur ${detail.totalCount}${
    detail.note ? ` - ${detail.note}` : ''
  }`

  return (
    <article className="panel panel--detail">
      <header className="section-title">
        <p className="eyebrow">Detail</p>
        <div>
          <h2>{detail.title}</h2>
          <p aria-live="polite">{helperText}</p>
        </div>
      </header>

      <div className="detail-toolbar">
        <label className="detail-search" htmlFor={searchId}>
          <span>Recherche integree</span>
          <input
            id={searchId}
            type="search"
            value={searchValue}
            placeholder="Nom, matricule, departement, service..."
            aria-controls={resultsId}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </label>

        {searchValue ? (
          <button className="ghost-button" type="button" onClick={onSearchClear}>
            Effacer
          </button>
        ) : null}
      </div>

      <div className="detail-list" id={resultsId}>
        {detail.items.length ? (
          detail.items.map((item) => (
            <button
              className={`detail-row detail-row--button${
                activeRecordId === item.recordId ? ' detail-row--active' : ''
              }`}
              type="button"
              key={item.recordId}
              onClick={() => onPersonClick?.(item)}
            >
              <div>
                <h3>{item.fullName}</h3>
                <p>
                  {item.department || 'Sans departement'} - {item.service || 'Sans service'}
                </p>
              </div>
              <div className="detail-meta">
                <span>{item.contract || 'Sans contrat'}</span>
                <b>{item.status || 'Sans statut'}</b>
              </div>
            </button>
          ))
        ) : (
          <div className="detail-empty detail-empty--rich">
            <strong>{searchValue ? 'Aucun resultat' : 'Aucune donnee a afficher'}</strong>
            <p>
              {searchValue
                ? 'Essaie un autre nom, service ou matricule pour retrouver la fiche.'
                : 'Selectionne une carte du dashboard ou lance une recherche globale pour afficher des personnes.'}
            </p>
            {searchValue ? (
              <button className="ghost-button" type="button" onClick={onSearchClear}>
                Reinitialiser le filtre
              </button>
            ) : null}
          </div>
        )}
      </div>
    </article>
  )
}
