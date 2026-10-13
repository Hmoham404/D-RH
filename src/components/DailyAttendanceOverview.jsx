import { useState } from 'react';
import { formatPointageDate } from '../lib/dailyPointage.js';
import { getEmployeeStcPeriod, isEmployeeHiredInMonth, isEmployeeStcInPeriod } from '../lib/employeeStatus.js';
import { KpiCard, ProductionFocusSection } from './AttendanceDashboard';
import AttendanceCharts from './AttendanceCharts';
import PayrollPresenceChart from './PayrollPresenceChart';
import DashboardIcon from './DashboardIcon';

const percent = (count, total) => total ? count / total * 100 : 0;
const isPresent = (person) => ['POINTAGE', 'AVR'].includes(person.status);
const isProduction = (person) => /^production/i.test(person.department || '');
const isMod = (person) => String(person.kind || '').toUpperCase() === 'MOD';
const serviceTypes = [
  { key: 'injection', label: 'Injection', tone: 'blue' },
  { key: 'metallisation', label: 'Metallisation', tone: 'orange' },
  { key: 'serigraphie', label: 'Serigraphie', tone: 'violet' },
  { key: 'assemblage', label: 'Assemblage', tone: 'green' },
  { key: 'autres', label: 'Autres', tone: 'slate' },
];

function formatRate(value, locale) {
  return new Intl.NumberFormat(locale, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Number(value || 0) / 100);
}

function daysSinceAccident(analysisDate) {
  if (!analysisDate) return 0;
  const start = new Date('2026-06-01T12:00:00Z');
  const end = new Date(`${analysisDate}T12:00:00Z`);
  return Math.max(0, Math.floor((end - start) / 86400000) + 1);
}

function RingMetric({ title, value, caption, tone = 'blue', icon = 'people', onClick }) {
  const Component = onClick ? 'button' : 'article';
  return (
    <Component className={`mod-metric mod-metric--${tone}${onClick ? ' is-clickable' : ''}`} type={onClick ? 'button' : undefined} onClick={onClick}>
      <div className="mod-metric__icon"><DashboardIcon type={icon} /></div>
      <h2>{title}</h2>
      <div className="mod-ring">
        <div className="mod-ring__core"><strong>{value}</strong></div>
      </div>
      <p>{caption}</p>
    </Component>
  );
}

function RatePanel({ tone, title, value, label, delta, previous, icon, ringPercent = 0, targetLabel, targetDraft, editing, onDoubleClick, onDraftChange, onSave, onCancel, saveLabel, cancelLabel, editHint }) {
  return (
    <article className={`mod-rate-card mod-rate-card--${tone}${onDoubleClick ? ' mod-rate-card--editable' : ''}`} onDoubleClick={onDoubleClick} title={onDoubleClick ? editHint : undefined}>
      <div className="mod-rate-card__icon"><DashboardIcon type={icon} /></div>
      <h2>{title}</h2>
      <div className="mod-rate-card__ring" style={{ '--rate-angle': `${Math.max(0, Math.min(100, Number(ringPercent) || 0)) * 3.6}deg` }}><strong>{value}</strong></div>
      <div className="mod-rate-card__copy">
        {editing ? <form className="mod-rate-target-editor" onSubmit={(event) => { event.preventDefault(); onSave(); }} onDoubleClick={(event) => event.stopPropagation()}>
          <label>{targetLabel}<input autoFocus aria-label={targetLabel} type="number" min="1" step="1" required value={targetDraft} onChange={(event) => onDraftChange(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') onCancel(); }} /></label>
          <div><button type="submit">{saveLabel}</button><button type="button" onClick={onCancel}>{cancelLabel}</button></div>
        </form> : <div>
          <span>{label}</span><strong>{delta}</strong>{previous && <small>{previous}</small>}
        </div>}
      </div>
    </article>
  );
}

export default function DailyAttendanceOverview({ day, history, analysisDate, payrollPeriod,
  baseEmployees, baseMonthDate, onOpen, target, onTargetChange, message, translate: t, locale, productionLabels }) {
  const [editingModTarget, setEditingModTarget] = useState(false);
  const [modTargetDraft, setModTargetDraft] = useState(String(target || 65));
  const number = (value) => Number(value || 0).toLocaleString(locale);
  const formatPercent = (count, total) => formatRate(percent(count, total), locale);
  const people = (day?.departments || []).flatMap((group) => group.people);
  const present = people.filter(isPresent);
  const late = people.filter((person) => person.delay > 0);
  const toPerson = (employee) => ({ ...employee, employeeKey: employee.zk || employee.id,
    id: employee.zk || employee.id, status: employee.status });
  const workforce = people;
  const absent = workforce.filter((person) => person.status === 'ABS');
  const production = workforce.filter(isProduction);
  const productionPresent = present.filter(isProduction);
  const productionAbsent = absent.filter(isProduction);
  const modPeople = production.filter(isMod);
  const modPresent = present.filter((person) => isProduction(person) && isMod(person));
  const modAbsent = productionAbsent.filter(isMod);
  const recruits = baseEmployees.filter((employee) => isEmployeeHiredInMonth(employee, baseMonthDate)).map(toPerson);
  const stc = baseEmployees.filter((employee) => isEmployeeStcInPeriod(employee, baseMonthDate)).map(toPerson);
  const productionRecruits = recruits.filter(isProduction);
  const productionStc = stc.filter(isProduction);
  const monthLabel = baseMonthDate.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  const stcPeriod = getEmployeeStcPeriod(baseMonthDate);
  const stcPeriodLabel = `${stcPeriod.startDate.toLocaleDateString(locale)} – ${stcPeriod.endDate.toLocaleDateString(locale)}`;
  const lists = {
    'production-total': { title: t('kpi.productionWorkforce'), people: production },
    'production-present': { title: t('daily.productionPresent'), people: productionPresent },
    'production-absent': { title: t('daily.productionAbsent'), people: productionAbsent },
    'production-new': { title: t('daily.productionNew'), people: productionRecruits },
    'production-stc': { title: t('daily.productionStc'), people: productionStc },
  };
  const productionKinds = ['MOI', 'MOD'].map((kind) => {
    const members = production.filter((person) => person.kind === kind);
    const absences = members.filter((person) => person.status === 'ABS');
    const modalKey = `production-${kind}`;
    lists[modalKey] = { title: t('daily.productionAbsent') + ' ' + kind, people: absences };
    return { key: kind, label: kind, tone: 'red', modalKey, effectiveCount: members.length,
      presentCount: members.filter(isPresent).length, absentPercent: percent(absences.length, members.length) };
  });
  const productionServices = serviceTypes.map((service) => {
    const members = production.filter((person) => {
      const department = (person.department || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const type = serviceTypes.find((item) => item.key !== 'autres' && department.includes(item.key));
      return (type?.key || 'autres') === service.key;
    });
    const modalKey = `production-service-${service.key}`;
    lists[modalKey] = { title: t('production.prefix') + ' ' + service.label, people: members };
    return { ...service, modalKey, effectiveCount: members.length, presentCount: members.filter(isPresent).length,
      absentPercent: percent(members.filter((person) => person.status === 'ABS').length, members.length) };
  });
  const modRate = percent(modPresent.length, modPeople.length);
  const modAbsentRate = percent(modAbsent.length, modPeople.length);
  const open = (title, peopleList) => onOpen({ title, people: peopleList, date: analysisDate });
  const safeTarget = Math.max(1, Math.round(Number(target || 65)));
  const targetCoverage = percent(modPresent.length, safeTarget);

  return (
    <section className="mod-dashboard">
      {message && <p className="daily-dashboard__message" role="status">{message}</p>}

      <div className="mod-dashboard__main">
        <div className="mod-dashboard__grid">
          <article className="mod-safety-card">
            <div className="mod-safety-card__icon"><DashboardIcon type="lock" /></div>
            <div>
              <h2>{t('daily.overview.accidentTitle')}</h2>
            </div>
            <strong>{number(daysSinceAccident(analysisDate))}</strong>
            <div className="mod-safety-card__gain"><b>+1</b><span>{t('daily.overview.eachDay')}<br />{t('daily.overview.accidentFree')}</span></div>
          </article>

          <RingMetric title={t('daily.overview.staffCount')} value={number(modPeople.length || production.length)} caption={t('daily.overview.totalMod')} tone="blue" onClick={() => open(t('daily.overview.staffCount'), modPeople.length ? modPeople : production)} />
          <RingMetric title={t('daily.overview.presentMod')} value={number(modPresent.length)} caption={t('daily.overview.onSite')} tone="green" onClick={() => open(t('daily.overview.presentMod'), modPresent)} />

          <div className="mod-dashboard__rates">
            <RatePanel tone="red" title={t('daily.overview.absentTitle')} value={formatRate(modAbsentRate, locale)} ringPercent={modAbsentRate} label={t('daily.overview.absentRate')} delta={t('daily.overview.absentDelta')} previous={t('daily.overview.previousMonth')} icon="clock" />
            <RatePanel
              tone="green" title={t('daily.overview.modRateTitle')} value={formatRate(targetCoverage, locale)} ringPercent={targetCoverage}
              label={t('daily.overview.coverage')} delta={`${number(modPresent.length)} / ${number(safeTarget)} ${t('daily.overview.modPresent')}`}
              previous="" icon="chart"
              targetLabel={t('daily.targetLabel', 'Objectif MOD production')} targetDraft={modTargetDraft} editing={editingModTarget}
              onDoubleClick={() => { setModTargetDraft(String(safeTarget)); setEditingModTarget(true); }}
              onDraftChange={setModTargetDraft}
              onSave={() => { onTargetChange?.(Math.max(1, Math.floor(Number(modTargetDraft) || safeTarget))); setEditingModTarget(false); }}
              onCancel={() => { setModTargetDraft(String(safeTarget)); setEditingModTarget(false); }}
              saveLabel={t('daily.overview.save', 'Enregistrer')} cancelLabel={t('daily.overview.cancel', 'Annuler')}
              editHint={t('daily.targetHint', 'Double-cliquez pour modifier l’objectif MOD production')}
            />
          </div>
        </div>

        <PayrollPresenceChart history={history} analysisDate={analysisDate} payrollPeriod={payrollPeriod} locale={locale} translate={t} />
      </div>

      <footer className="mod-dashboard__footer">
        <strong><DashboardIcon type="clock" /> {t('daily.overview.advice')}</strong>
        <span>{t('daily.overview.stable')}</span>
        <small>{t('daily.overview.lastUpdated', 'Dernière mise à jour : {date} à 10:24', { date: analysisDate ? formatPointageDate(analysisDate, locale) : '-' })}</small>
        <b>{t('daily.overview.dataCurrent')}</b>
      </footer>

      <section className="daily-dashboard__legacy" aria-label={t('daily.summary', 'Synthese de la journee')}>
        <div className="daily-dashboard__actions">
          <div><h2>{t('daily.summary', 'Synthese de la journee')}</h2></div>
        </div>
        <section className="rh-kpi-grid" aria-label={t('daily.summary')}>
          <KpiCard tone="indigo" label={t('kpi.workforceGlobal')} value={number(workforce.length)} note={monthLabel} onClick={() => open(t('kpi.workforceGlobal'), workforce)} />
          <KpiCard tone="green" label={t('kpi.presents')} value={number(present.length)} note={formatPercent(present.length, workforce.length)} onClick={() => open(t('kpi.presents'), present)} />
          <KpiCard tone="orange" label={t('kpi.absents')} value={number(absent.length)} note={formatPercent(absent.length, workforce.length)} onClick={() => open(t('kpi.absents'), absent)} />
          <KpiCard tone="red" label={t('kpi.late')} value={number(late.length)} note={formatPercent(late.length, present.length)} onClick={() => open(t('kpi.late'), late)} />
          <KpiCard tone="slate" label={t('kpi.recruitments')} value={number(recruits.length)} note={monthLabel} onClick={() => open(t('kpi.recruitments'), recruits)} />
          <KpiCard tone="blue" label={t('kpi.stcMonth')} value={number(stc.length)} note={stcPeriodLabel} onClick={() => open(t('kpi.stcMonth'), stc)} />
        </section>
        <ProductionFocusSection
          dashboardCharts={<AttendanceCharts history={history} analysisDate={analysisDate} absent={absent.length} late={late.length} stc={stc.length} locale={locale} translate={t} />}
          productionMetrics={{ total: production.length, present: productionPresent.length, absent: productionAbsent.length,
            presentRate: percent(productionPresent.length, production.length), absentRate: percent(productionAbsent.length, production.length),
            newEmployees: productionRecruits.length, stc: productionStc.length, stcRate: percent(productionStc.length, production.length), periodLabel: monthLabel }}
          productionServiceBreakdown={productionServices}
          productionKindBreakdown={productionKinds}
          onOpenModal={(key) => onOpen({ ...lists[key], date: analysisDate })}
          labels={productionLabels}
          locale={locale}
        />
      </section>
    </section>
  );
}
