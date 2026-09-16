import { KpiCard, ProductionFocusSection, ProductionModTargetGauge } from './AttendanceDashboard';
import { formatPointageDate } from '../lib/dailyPointage.js';
import { isEmployeeActiveInMonth, isEmployeeHiredInMonth, isEmployeeStcInMonth } from '../lib/employeeStatus.js';
import factoryPhoto from '../../DSC01462.jpg';
import AttendanceCharts from './AttendanceCharts';
import DashboardIcon from './DashboardIcon';

const percent = (count, total) => total ? count / total * 100 : 0;
const isPresent = (person) => ['POINTAGE', 'AVR'].includes(person.status);
const isProduction = (person) => /^production/i.test(person.department || '');
const getPersonKey = (person) => String(person.employeeKey || person.zk || person.id || person.finalCode || person.saber || person.fullName || '').trim();
const serviceTypes = [
  { key: 'injection', label: 'Injection', tone: 'blue' },
  { key: 'metallisation', label: 'Métallisation', tone: 'orange' },
  { key: 'serigraphie', label: 'Sérigraphie', tone: 'violet' },
  { key: 'assemblage', label: 'Assemblage', tone: 'green' },
  { key: 'autres', label: 'Autres', tone: 'slate' },
];

export default function DailyAttendanceOverview({ day, history, dates, analysisDate, onDateChange,
  baseEmployees, baseMonthDate, onOpen, target, onTargetChange, onImport,
  busy, importDisabled, message, translate: t, locale, productionLabels }) {
  const number = (value) => Number(value || 0).toLocaleString(locale);
  const formatPercent = (count, total) => new Intl.NumberFormat(locale, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(percent(count, total) / 100);
  const people = (day?.departments || []).flatMap((group) => group.people);
  const present = people.filter(isPresent);
  const late = people.filter((person) => person.delay > 0);
  const toPerson = (employee) => ({ ...employee, employeeKey: employee.zk || employee.id,
    id: employee.zk || employee.id, status: employee.status });
  const activeBase = baseEmployees.filter((employee) => isEmployeeActiveInMonth(employee, baseMonthDate)).map(toPerson);
  const presentKeys = new Set(present.map(getPersonKey).filter(Boolean));
  const peopleByKey = new Map(people.map((person) => [getPersonKey(person), person]));
  const workforce = activeBase.length ? activeBase.map((employee) => ({ ...employee, ...(peopleByKey.get(getPersonKey(employee)) || {}) })) : people;
  const absent = workforce.filter((person) => !presentKeys.has(getPersonKey(person))).map((person) => ({ ...person, status: 'ABS' }));
  const production = workforce.filter(isProduction);
  const productionPresent = present.filter(isProduction);
  const productionAbsent = production.filter((person) => !presentKeys.has(getPersonKey(person))).map((person) => ({ ...person, status: 'ABS' }));
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
      <div className="daily-dashboard__welcome" style={{ '--factory-photo': `url("${factoryPhoto}")` }}>
        <p className="rh-eyebrow">{t('daily.greeting', 'Bonjour,')}</p>
        <h1>ZK Dashboard</h1>
        <p className="daily-dashboard__subtitle">{t('daily.subtitle', 'Suivi en temps réel de la présence du personnel')}</p>
        <div className="daily-dashboard__date">
          <label htmlFor="daily-analysis-date">{t('daily.analysisDate')}</label>
          <select id="daily-analysis-date" value={analysisDate || ''} onChange={(event) => onDateChange(event.target.value)} disabled={!dates.length}>
            {!dates.length && <option value="">{t('daily.noDays')}</option>}
            {dates.map((date) => <option key={date} value={date}>{formatPointageDate(date, locale)}</option>)}
          </select>
        </div>
      </div>
      <div className="rh-hero__center"><ProductionModTargetGauge presentCount={productionKinds.find((item) => item.key === 'MOD')?.presentCount || 0} target={target} onTargetChange={onTargetChange} locale={locale} targetHint={t('daily.targetHint')} targetLabel={t('daily.targetLabel')} /></div>
    </div>
    <div className="daily-dashboard__actions">
      <div><h2>{t('daily.summary', 'Vue d’ensemble')}</h2></div>
      <label className="rh-import-button"><DashboardIcon type="upload" /><input type="file" accept=".xlsx,.xls" disabled={busy || importDisabled} onChange={onImport} />{busy ? t('hero.importing') : t('hero.importExcel')}</label>
    </div>
    {message && <p className="daily-dashboard__message" role="status">{message}</p>}
    <section className="rh-kpi-grid" aria-label={t('daily.summary')}>
      <KpiCard tone="indigo" label={t('kpi.workforceGlobal')} value={number(workforce.length)} note={monthLabel} onClick={() => open(t('kpi.workforceGlobal'), workforce)} />
      <KpiCard tone="green" label={t('kpi.presents')} value={number(present.length)} note={formatPercent(present.length, workforce.length)} onClick={() => open(t('kpi.presents'), present)} />
      <KpiCard tone="orange" label={t('kpi.absents')} value={number(absent.length)} note={formatPercent(absent.length, workforce.length)} onClick={() => open(t('kpi.absents'), absent)} />
      <KpiCard tone="red" label={t('kpi.late')} value={number(late.length)} note={formatPercent(late.length, present.length)} onClick={() => open(t('kpi.late'), late)} />
      <KpiCard tone="slate" label={t('kpi.recruitments')} value={number(recruits.length)} note={monthLabel} onClick={() => open(t('kpi.recruitments'), recruits)} />
      <KpiCard tone="blue" label={t('kpi.stcMonth')} value={number(stc.length)} note={formatPercent(stc.length, workforce.length)} onClick={() => open(t('kpi.stcMonth'), stc)} />
    </section>
    <ProductionFocusSection
      dashboardCharts={<AttendanceCharts history={history} analysisDate={analysisDate} absent={absent.length} late={late.length} stc={stc.length} locale={locale} translate={t} />}
      productionMetrics={{ total: production.length, present: productionPresent.length, absent: productionAbsent.length,
        presentRate: percent(productionPresent.length, production.length), absentRate: percent(productionAbsent.length, production.length),
        newEmployees: productionRecruits.length, stc: productionStc.length, stcRate: percent(productionStc.length, production.length), periodLabel: monthLabel }}
      productionServiceBreakdown={productionServices} productionKindBreakdown={productionKinds}
      onOpenModal={(key) => onOpen({ ...lists[key], date: analysisDate })} labels={productionLabels} locale={locale}
    />
    <footer className="daily-dashboard__footer"><span>“Excellence People. Innovative Beauty.”</span><i /><span>MYC Beauty Innovation Tunisia</span></footer>
  </>;
}
