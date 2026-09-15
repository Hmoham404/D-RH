import { useEffect, useState } from 'react';
import DashboardIcon from './DashboardIcon';

const DEFAULT_PRODUCTION_MOD_TARGET = 65;
const formatPercent = (value, locale) => locale
  ? new Intl.NumberFormat(locale, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Number(value || 0) / 100)
  : `${Number(value || 0).toFixed(1)}%`;
function normalizePositiveTarget(value, fallback = DEFAULT_PRODUCTION_MOD_TARGET) {
  const numeric = Math.round(Number(value));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

export function KpiCard({ tone, label, value, note, tag = '', isActive = false, onClick }) {
  const Component = onClick ? 'button' : 'article';
  const isPercentNote = /[%٪]/.test(String(note || ''));
  const hasNote = Boolean(String(note || '').trim());
  const isCompactLabel = String(label || '').length > 18;

  return (
    <Component
      className={`rh-kpi-card rh-kpi-card--${tone}${onClick ? ' is-clickable' : ''}${isActive ? ' is-active' : ''}`}
      type={onClick ? 'button' : undefined}
      onClick={onClick}
    >
      <div className={`rh-kpi-card__icon rh-kpi-card__icon--${tone}`}><DashboardIcon type={tone === 'red' ? 'clock' : tone === 'blue' ? 'file' : tone === 'slate' ? 'recruit' : 'people'} /></div>
      <div className={`rh-kpi-card__body${tag ? ' has-tag' : ''}${isPercentNote ? ' has-percent' : ''}`}>
        {tag ? <small className="rh-kpi-card__tag">{tag}</small> : null}
        <span className={`rh-kpi-card__label${isCompactLabel ? ' is-compact' : ''}`}>{label}</span>
        <strong className={isPercentNote ? 'rh-kpi-card__value rh-kpi-card__value--accent' : 'rh-kpi-card__value'}>
          {value}
        </strong>
        {hasNote ? (
          <p className={isPercentNote ? 'rh-kpi-card__note rh-kpi-card__note--percent' : 'rh-kpi-card__note'}>
            {note}
          </p>
        ) : null}
      </div>
    </Component>
  );
}

export function ProductionModTargetGauge({ presentCount, target, onTargetChange, locale, targetHint = 'Double-cliquez pour changer le target MOD production', targetLabel = 'Target MOD production' }) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftTarget, setDraftTarget] = useState(String(target || DEFAULT_PRODUCTION_MOD_TARGET));
  const safeTarget = normalizePositiveTarget(target);
  const percent = safeTarget ? (Number(presentCount || 0) / safeTarget) * 100 : 0;
  const clampedPercent = Math.max(0, Math.min(100, percent));
  // Couleur : >= 95 vert, >= 90 jaune, < 90 rouge
  const tone = percent >= 95 ? 'green' : percent >= 90 ? 'yellow' : 'red';

  useEffect(() => {
    if (!isEditing) {
      setDraftTarget(String(safeTarget));
    }
  }, [isEditing, safeTarget]);

  function saveTarget() {
    const nextTarget = normalizePositiveTarget(draftTarget, safeTarget);
    onTargetChange(nextTarget);
    setIsEditing(false);
  }

  function cancelEdit() {
    setDraftTarget(String(safeTarget));
    setIsEditing(false);
  }

  const tones = { green: '#0d9f76', yellow: '#d69620', red: '#e76868' };
  const ring = (value, label, color, amount = 100) => (
    <div className="flex min-w-0 flex-col items-center gap-4">
      <div className="grid size-[84px] shrink-0 place-items-center rounded-full p-[6px] sm:size-[104px]"
        style={{ background: `conic-gradient(${color} ${amount * 3.6}deg, #edf0f5 0deg)` }}>
        <div className="flex size-full items-center justify-center rounded-full bg-white">
          <strong className="text-lg font-extrabold tracking-tight text-ink tabular-nums sm:text-2xl">{value}</strong>
        </div>
      </div>
      <span className="text-center text-[10px] font-semibold text-slate-500 sm:text-xs">{label}</span>
    </div>
  );

  return (
    <div className="dashboard-gauges flex h-full min-h-56 flex-col justify-center gap-6 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-panel sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-bold text-ink">{targetLabel}</span>
        <button type="button" className="rounded-md px-2 py-1 text-[10px] font-semibold text-brand transition-colors hover:bg-blue-50"
          aria-label={targetHint} onClick={() => setIsEditing(true)}><DashboardIcon type="edit" /></button>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="min-w-0" onDoubleClick={() => setIsEditing(true)}>
          {isEditing ? <form className="flex h-full flex-col items-center justify-center gap-2" onSubmit={(event) => { event.preventDefault(); saveTarget(); }}>
            <input autoFocus aria-label={targetLabel} type="number" min="1" step="1" required
              className="w-20 text-center" value={draftTarget} onChange={(event) => setDraftTarget(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Escape') cancelEdit(); }} />
            <div className="flex gap-2">
              <button type="submit" aria-label="Enregistrer l’objectif" className="rounded-md bg-brand px-2 py-1 text-xs text-white">✓</button>
              <button type="button" aria-label="Annuler" onClick={cancelEdit} className="rounded-md bg-slate-100 px-2 py-1 text-xs">×</button>
            </div>
          </form> : ring(safeTarget.toLocaleString(locale), 'Objectif', '#346fda')}
        </div>
        {ring(Number(presentCount || 0).toLocaleString(locale), 'MOD présents', '#0d9f76')}
        {ring(formatPercent(percent, locale), 'Couverture', tones[tone], clampedPercent)}
      </div>
    </div>
  );
}

export function ProductionFocusSection({
  productionMetrics,
  productionServiceBreakdown,
  productionKindBreakdown,
  activeModalKey,
  onOpenModal,
  labels,
  locale,
  dashboardCharts,
}) {
  const number = (value) => locale ? Number(value || 0).toLocaleString(locale) : value;
  const productionPresenceKinds = productionKindBreakdown.filter((item) => ['MOI', 'MOD'].includes(item.key));

  return (
    <section className={`rh-section-block${dashboardCharts ? ' rh-section-block--dashboard' : ''}`}>
      <div className="rh-section-block__header">
        <div>
          <p className="rh-eyebrow">{labels.focus}</p>
          <h3>{labels.title}</h3>
        </div>
        <span className="rh-panel-pill">{labels.employeesFollowed(productionMetrics.total)}</span>
      </div>

      <div className="rh-kpi-grid rh-kpi-grid--department">
        <KpiCard
          tone="indigo"
          label={labels.productionWorkforce}
          value={number(productionMetrics.total)}
          note={productionMetrics.periodLabel}
          isActive={activeModalKey === 'production-total'}
          onClick={() => onOpenModal('production-total')}
        />
        <KpiCard
          tone="green"
          label={labels.presents}
          value={number(productionMetrics.present)}
          note={formatPercent(productionMetrics.presentRate, locale)}
          isActive={activeModalKey === 'production-present'}
          onClick={() => onOpenModal('production-present')}
        />
        <KpiCard
          tone="orange"
          label={labels.absents}
          value={number(productionMetrics.absent)}
          note={formatPercent(productionMetrics.absentRate, locale)}
          isActive={activeModalKey === 'production-absent'}
          onClick={() => onOpenModal('production-absent')}
        />
        <KpiCard
          tone="slate"
          label={labels.recruitments}
          value={number(productionMetrics.newEmployees)}
          note={productionMetrics.periodLabel}
          isActive={activeModalKey === 'production-new'}
          onClick={() => onOpenModal('production-new')}
        />
        <KpiCard
          tone="blue"
          label={labels.stcMonth}
          value={number(productionMetrics.stc)}
          note={formatPercent(productionMetrics.stcRate, locale)}
          isActive={activeModalKey === 'production-stc'}
          onClick={() => onOpenModal('production-stc')}
        />
      </div>

      <div className="rh-production-breakdown">
        <div className="rh-production-breakdown__topline">
          <div className="rh-production-breakdown__group rh-production-breakdown__group--presence">
            <div className="rh-production-breakdown__title">{labels.kindAbsence}</div>
            <div className="rh-production-breakdown__stack rh-production-breakdown__stack--presence">
              {productionPresenceKinds.map((item) => (
                <button
                  key={`presence-${item.key}`}
                  className={`rh-production-presence-card rh-production-presence-card--${item.tone}${activeModalKey === item.modalKey ? ' is-active' : ''}`}
                  type="button"
                  onClick={() => onOpenModal(item.modalKey)}
                  style={{ '--presence-angle': `${Math.max(0, Math.min(360, item.absentPercent * 3.6))}deg` }}
                >
                  <div className="rh-production-presence-card__header">
                    <span>{item.label}</span>
                    <small>{labels.kindAbsence}</small>
                  </div>
                  <div className="rh-production-presence-card__body">
                    <div className={`rh-production-presence-card__ring rh-production-presence-card__ring--${item.tone}`}>
                      <div className="rh-production-presence-card__ring-core">
                        <strong>{formatPercent(item.absentPercent, locale)}</strong>
                        <span>{labels.absence}</span>
                      </div>
                    </div>
                    <div className="rh-production-presence-card__stats">
                      <div className="rh-production-presence-card__stat">
                        <small>{labels.presents}</small>
                        <b>{number(item.presentCount)}</b>
                      </div>
                      <div className="rh-production-presence-card__stat">
                        <small>{labels.total}</small>
                        <b>{number(item.effectiveCount)}</b>
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="rh-production-breakdown__group rh-production-breakdown__group--full">
          <div className="rh-production-breakdown__title">{labels.productionTypes}</div>
          <div className="rh-production-breakdown__grid">
            {productionServiceBreakdown.map((item) => (
              <button
                key={item.key}
                className={`rh-production-chip rh-production-chip--${item.tone}${activeModalKey === item.modalKey ? ' is-active' : ''}`}
                type="button"
                onClick={() => onOpenModal(item.modalKey)}
              >
                <span>{`${labels.prefix} ${labels.serviceLabel(item.key, item.label)}`}</span>
                <div className="rh-production-chip__stats">
                  <div className="rh-production-chip__stat">
                    <small>{labels.total}</small>
                    <strong>{number(item.effectiveCount)}</strong>
                  </div>
                  <div className="rh-production-chip__stat">
                    <small>{labels.presents}</small>
                    <strong>{number(item.presentCount)}</strong>
                  </div>
                </div>
                <div className="rh-production-chip__percent-row">
                  <small>{labels.absence}</small>
                  <strong className="rh-production-chip__percent">{formatPercent(item.absentPercent, locale)}</strong>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
      {dashboardCharts}
    </section>
  );
}
