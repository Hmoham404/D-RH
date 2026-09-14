import { useEffect, useState } from 'react';

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
      <div className={`rh-kpi-card__icon rh-kpi-card__icon--${tone}`} />
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

  const ringSize = '140px';
  const labelStyle = { fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '2px' };
  const valueStyle = { fontSize: '2.1rem', color: '#0f172a', fontWeight: '800', lineHeight: '1' };

  return (
    <div style={{ display: 'flex', gap: '32px', alignItems: 'center', justifyContent: 'center', width: 'auto' }}>
      
      {/* Cadre 1 : Objectif (Target) */}
      <div 
        className="production-mod-target"
        style={{ cursor: 'pointer', padding: '24px 32px', borderRadius: '32px', background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(244, 247, 252, 0.92))', boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}
        onDoubleClick={() => setIsEditing(true)}
        title={targetHint}
      >
        <div className="production-mod-target__ring" style={{ width: ringSize, '--target-color': '#cbd5e1', '--target-angle': '360deg' }}>
          <div className="production-mod-target__core">
            <span style={labelStyle}>Objectif</span>
            {isEditing ? (
              <input
                autoFocus
                aria-label={targetLabel}
                type="number"
                min="1"
                step="1"
                value={draftTarget}
                onChange={(event) => setDraftTarget(event.target.value)}
                onBlur={saveTarget}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') saveTarget();
                  if (event.key === 'Escape') cancelEdit();
                }}
                style={{ fontSize: '1.6rem', width: '80px', height: '44px', textAlign: 'center', border: '2px solid #3b82f6', borderRadius: '12px', background: '#fff' }}
              />
            ) : (
              <strong style={valueStyle}>{safeTarget.toLocaleString(locale)}</strong>
            )}
          </div>
        </div>
      </div>

      {/* Cadre 2 : MOD Présents */}
      <div 
        className="production-mod-target"
        style={{ padding: '24px 32px', borderRadius: '32px', background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(244, 247, 252, 0.92))', boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}
      >
        <div className={`production-mod-target__ring production-mod-target--${tone}`} style={{ width: ringSize, '--target-angle': '360deg' }}>
          <div className="production-mod-target__core">
            <span style={labelStyle}>Présents</span>
            <strong style={valueStyle}>{Number(presentCount || 0).toLocaleString(locale)}</strong>
          </div>
        </div>
      </div>

      {/* Cadre 3 : Pourcentage (Couverture) */}
      <div 
        className="production-mod-target"
        style={{ padding: '24px 32px', borderRadius: '32px', background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(244, 247, 252, 0.92))', boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}
      >
        <div className={`production-mod-target__ring production-mod-target--${tone}`} style={{ width: ringSize, '--target-angle': `${clampedPercent * 3.6}deg` }}>
          <div className="production-mod-target__core">
            <span style={labelStyle}>Couverture</span>
            <strong style={valueStyle}>{formatPercent(percent, locale)}</strong>
          </div>
        </div>
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
}) {
  const number = (value) => locale ? Number(value || 0).toLocaleString(locale) : value;
  const productionPresenceKinds = productionKindBreakdown.filter((item) => ['MOI', 'MOD'].includes(item.key));

  return (
    <section className="rh-section-block">
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
    </section>
  );
}
