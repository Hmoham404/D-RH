import { KpiCard, ProductionFocusSection, ProductionModTargetGauge } from './AttendanceDashboard';
import { formatPointageDate } from '../lib/dailyPointage.js';
import { isEmployeeHiredInMonth, isEmployeeStcInMonth } from '../lib/employeeStatus.js';

const percent = (count, total) => total ? count / total * 100 : 0;
const isPresent = (person) => ['POINTAGE', 'AVR'].includes(person.status);
const isProduction = (person) => /^production/i.test(person.department || '');
const serviceTypes = [
  { key: 'injection', label: 'Injection', tone: 'blue' },
  { key: 'metallisation', label: 'Métallisation', tone: 'orange' },
  { key: 'serigraphie', label: 'Sérigraphie', tone: 'violet' },
  { key: 'assemblage', label: 'Assemblage', tone: 'green' },
  { key: 'autres', label: 'Autres', tone: 'slate' },
];

export default function DailyAttendanceOverview({ day, dates, analysisDate, onDateChange,
  baseEmployees, baseMonthDate, onOpen, target, onTargetChange, onImport,
  busy, importDisabled, fileName, importedAt, message, translate: t, locale, productionLabels }) {
  const number = (value) => Number(value || 0).toLocaleString(locale);
  const formatPercent = (count, total) => new Intl.NumberFormat(locale, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(percent(count, total) / 100);
  const people = (day?.departments || []).flatMap((group) => group.people);
  const present = people.filter(isPresent);
  const absent = people.filter((person) => person.status === 'ABS');
  const late = people.filter((person) => person.delay > 0);
  const production = people.filter(isProduction);
  const productionPresent = production.filter(isPresent);
  const productionAbsent = production.filter((person) => person.status === 'ABS');
  const toPerson = (employee) => ({ ...employee, employeeKey: employee.zk || employee.id,
    id: employee.zk || employee.id, status: employee.status });
  const recruits = baseEmployees.filter((employee) => isEmployeeHiredInMonth(employee, baseMonthDate)).map(toPerson);
  const stc = baseEmployees.filter((employee) => isEmployeeStcInMonth(employee, baseMonthDate)).map(toPerson);
  const productionRecruits = recruits.filter(isProduction);
  const productionStc = stc.filter(isProduction);
  const monthLabel = baseMonthDate.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
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
  const open = (label, members) => onOpen({ title: label, people: members, date: analysisDate });

  return <>
    <div className="rh-hero daily-dashboard__header">
      <div>
        <p className="rh-eyebrow">{t('hero.eyebrow')}</p>
        <h1>ZK Dashboard</h1>
        <div className="daily-dashboard__date">
          <label htmlFor="daily-analysis-date">{t('daily.analysisDate')}</label>
          <select id="daily-analysis-date" value={analysisDate || ''} onChange={(event) => onDateChange(event.target.value)} disabled={!dates.length}>
            {!dates.length && <option value="">{t('daily.noDays')}</option>}
            {dates.map((date) => <option key={date} value={date}>{formatPointageDate(date, locale)}</option>)}
          </select>
        </div>
      </div>
      <div className="rh-hero__center"><ProductionModTargetGauge presentCount={productionKinds.find((item) => item.key === 'MOD')?.presentCount || 0} target={target} onTargetChange={onTargetChange} locale={locale} targetHint={t('daily.targetHint')} targetLabel={t('daily.targetLabel')} /></div>
      <div className="rh-toolbar">
        <label className="rh-import-button"><input type="file" accept=".xlsx,.xls" disabled={busy || importDisabled} onChange={onImport} />{busy ? t('hero.importing') : t('hero.importExcel')}</label>
        {fileName && <span className="rh-status-pill">{fileName}{importedAt ? ` · ${new Date(importedAt).toLocaleString(locale)}` : ''}</span>}
      </div>
    </div>
    {message && <p className="daily-dashboard__message" role="status">{message}</p>}
    <section className="rh-kpi-grid" aria-label={t('daily.summary')}>
      <KpiCard tone="indigo" label={t('kpi.workforceGlobal')} value={number(people.length)} note={monthLabel} onClick={() => open(t('kpi.workforceGlobal'), people)} />
      <KpiCard tone="green" label={t('kpi.presents')} value={number(present.length)} note={formatPercent(present.length, people.length)} onClick={() => open(t('kpi.presents'), present)} />
      <KpiCard tone="orange" label={t('kpi.absents')} value={number(absent.length)} note={formatPercent(absent.length, people.length)} onClick={() => open(t('kpi.absents'), absent)} />
      <KpiCard tone="red" label={t('kpi.late')} value={number(late.length)} note={formatPercent(late.length, present.length)} onClick={() => open(t('kpi.late'), late)} />
      <KpiCard tone="slate" label={t('kpi.recruitments')} value={number(recruits.length)} note={monthLabel} onClick={() => open(t('kpi.recruitments'), recruits)} />
      <KpiCard tone="blue" label={t('kpi.stcMonth')} value={number(stc.length)} note={formatPercent(stc.length, people.length)} onClick={() => open(t('kpi.stcMonth'), stc)} />
    </section>
    <ProductionFocusSection
      productionMetrics={{ total: production.length, present: productionPresent.length, absent: productionAbsent.length,
        presentRate: percent(productionPresent.length, production.length), absentRate: percent(productionAbsent.length, production.length),
        newEmployees: productionRecruits.length, stc: productionStc.length, stcRate: percent(productionStc.length, production.length), periodLabel: monthLabel }}
      productionServiceBreakdown={productionServices} productionKindBreakdown={productionKinds}
      onOpenModal={(key) => onOpen({ ...lists[key], date: analysisDate })} labels={productionLabels} locale={locale}
    />
  </>;
}
