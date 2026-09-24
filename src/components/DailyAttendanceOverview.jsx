import { useState } from 'react';
import { formatPointageDate } from '../lib/dailyPointage.js';
import { isEmployeeHiredInMonth, isEmployeeStcInMonth } from '../lib/employeeStatus.js';
import { KpiCard, ProductionFocusSection } from './AttendanceDashboard';
import AttendanceCharts from './AttendanceCharts';
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

function RatePanel({ tone, title, value, label, delta, previous, icon }) {
  return (
    <article className={`mod-rate-card mod-rate-card--${tone}`}>
      <div className="mod-rate-card__icon"><DashboardIcon type={icon} /></div>
      <div className="mod-rate-card__ring"><strong>{value}</strong></div>
      <div className="mod-rate-card__copy">
        <h2>{title}</h2>
        <div>
          <span>{label}</span>
          <strong>{delta}</strong>
          <small>{previous}</small>
        </div>
      </div>
    </article>
  );
}

function getModRateFromDay(day) {
  const mod = (day?.departments || [])
    .filter((group) => /^production/i.test(group.label || ''))
    .flatMap((group) => group.kinds || [])
    .filter((kind) => String(kind.label || '').toUpperCase() === 'MOD')
    .reduce((total, kind) => ({
      expected: total.expected + Number(kind.expected || 0),
      present: total.present + Number(kind.present || 0),
    }), { expected: 0, present: 0 });
  return mod.expected ? { value: mod.present / mod.expected * 100, present: mod.present, expected: mod.expected } : null;
}

function average(values) {
  const usable = values.filter((value) => Number.isFinite(value));
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
}

function getUtcDate(isoDate) {
  return new Date(`${isoDate}T12:00:00Z`);
}

function getWeekNumber(date) {
  const first = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 12));
  return Math.floor((date.getUTCDate() + first.getUTCDay() - 1) / 7) + 1;
}

function buildChartDataset(history, analysisDate, period, locale, translate) {
  const sorted = [...(history || [])]
    .filter((day) => day.isoDate && day.isoDate <= analysisDate)
    .sort((a, b) => a.isoDate.localeCompare(b.isoDate));
  const current = analysisDate ? getUtcDate(analysisDate) : new Date();
  const monthFormatter = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' });
  const weekdayFormatter = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });

  if (period === 'week') {
    const start = new Date(current);
    const day = start.getUTCDay() || 7;
    start.setUTCDate(start.getUTCDate() - day + 1);
    const labels = Array.from({ length: 5 }, (_, index) => {
      const date = new Date(start);
      date.setUTCDate(start.getUTCDate() + index);
      return { isoDate: date.toISOString().slice(0, 10), label: weekdayFormatter.format(date) };
    });
    const values = labels.map(({ isoDate }) => {
      const rate = getModRateFromDay(sorted.find((item) => item.isoDate === isoDate));
      return rate?.value ?? null;
    });
    return { labels: labels.map((item) => item.label), values, captions: [{ x: 292, label: translate('daily.overview.currentWeek') }] };
  }

  if (period === 'month') {
    const month = current.getUTCMonth();
    const year = current.getUTCFullYear();
    const buckets = new Map();
    sorted.forEach((day) => {
      const date = getUtcDate(day.isoDate);
      if (date.getUTCMonth() !== month || date.getUTCFullYear() !== year) return;
      const week = getWeekNumber(date);
      const rate = getModRateFromDay(day);
      if (!rate) return;
      if (!buckets.has(week)) buckets.set(week, []);
      buckets.get(week).push(rate.value);
    });
    const weeks = Array.from({ length: Math.max(4, ...buckets.keys(), 4) }, (_, index) => index + 1);
    return {
      labels: weeks.map((week) => `S${week}`),
      values: weeks.map((week) => average(buckets.get(week) || [])),
      captions: [{ x: 292, label: translate('daily.overview.currentMonth', 'Mois actuel ({month})', { month: monthFormatter.format(current) }) }],
    };
  }

  const monthKeys = [];
  for (let offset = 2; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - offset, 1, 12));
    monthKeys.push({ key: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`, label: monthFormatter.format(date) });
  }
  const monthBuckets = new Map(monthKeys.map((item) => [item.key, []]));
  const weekBuckets = new Map();
  const weekLabels = [];
  const weekStart = new Date(current);
  const currentDay = weekStart.getUTCDay() || 7;
  weekStart.setUTCDate(weekStart.getUTCDate() - currentDay + 1);
  const weekdays = Array.from({ length: 5 }, (_, index) => {
    const date = new Date(weekStart);
    date.setUTCDate(weekStart.getUTCDate() + index);
    return { isoDate: date.toISOString().slice(0, 10), label: weekdayFormatter.format(date) };
  });

  sorted.forEach((day) => {
    const date = getUtcDate(day.isoDate);
    const rate = getModRateFromDay(day);
    if (!rate) return;
    const monthKey = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    if (monthBuckets.has(monthKey)) monthBuckets.get(monthKey).push(rate.value);
    if (date.getUTCMonth() === current.getUTCMonth() && date.getUTCFullYear() === current.getUTCFullYear()) {
      const week = getWeekNumber(date);
      if (!weekBuckets.has(week)) {
        weekBuckets.set(week, []);
        weekLabels.push(week);
      }
      weekBuckets.get(week).push(rate.value);
    }
  });

  const labels = [
    ...monthKeys.map((item) => item.label),
    ...weekLabels.map((week) => `S${week}`),
    ...weekdays.map((item) => item.label),
  ];
  const values = [
    ...monthKeys.map((item) => average(monthBuckets.get(item.key) || [])),
    ...weekLabels.map((week) => average(weekBuckets.get(week) || [])),
    ...weekdays.map(({ isoDate }) => getModRateFromDay(sorted.find((item) => item.isoDate === isoDate))?.value ?? null),
  ];
  return {
    labels,
    values,
    captions: [
      { x: 98, label: translate('daily.overview.lastThreeMonths') },
      { x: 292, label: translate('daily.overview.currentMonth', 'Mois actuel ({month})', { month: monthFormatter.format(current) }) },
      { x: 470, label: translate('daily.overview.currentWeek') },
    ],
  };
}

function PresenceEvolutionChart({ history = [], analysisDate, currentRate, locale, translate }) {
  const [period, setPeriod] = useState('quarter');
  const latestRate = Math.round(currentRate || 87);
  const titles = {
    quarter: translate('daily.overview.importedQuarter'),
    month: translate('daily.overview.importedMonth'),
    week: translate('daily.overview.importedWeek'),
  };
  const dataset = buildChartDataset(history, analysisDate, period, locale, translate);
  const labels = dataset.labels.length ? dataset.labels : ['MOD'];
  const values = (dataset.values.length ? dataset.values : [latestRate]).map((value) => value ?? null);
  const captions = dataset.captions;
  const plottableValues = values.map((value) => Number.isFinite(value) ? value : null);
  const x = (index) => 48 + index * 492 / Math.max(1, values.length - 1);
  const y = (value) => 120 - value * 0.9;
  const points = plottableValues.map((value, index) => value === null ? null : [x(index), y(value)]);
  const segments = [];
  points.forEach((point, index) => {
    if (!point) return;
    if (index === 0 || !points[index - 1]) segments.push([]);
    segments.at(-1).push(point);
  });
  const tabs = [
    { key: 'quarter', label: translate('daily.overview.quarter') },
    { key: 'month', label: translate('daily.overview.month') },
    { key: 'week', label: translate('daily.overview.week') },
  ];

  return (
    <article className="mod-presence-chart">
      <header>
        <div>
          <span className="mod-section-icon"><DashboardIcon type="chart" /></span>
          <div>
            <h2>{translate('daily.overview.evolution')}</h2>
            <p>{titles[period]}</p>
          </div>
        </div>
        <div className="mod-chart-tabs" aria-label={translate('daily.overview.periodAria')}>
          {tabs.map((tab) => (
            <button
              key={tab.key}
              className={period === tab.key ? 'is-active' : ''}
              type="button"
              aria-pressed={period === tab.key}
              onClick={() => setPeriod(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </header>
      <svg viewBox="0 0 570 178" role="img" aria-label={values.map((value, index) => `${labels[index]}: ${value === null ? 'sans donnees' : `${Math.round(value)}%`}`).join(', ')}>
        <defs>
          <linearGradient id="presenceEvolutionFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2f80ed" stopOpacity=".32" />
            <stop offset="100%" stopColor="#2f80ed" stopOpacity=".04" />
          </linearGradient>
        </defs>
        {[0, 25, 50, 75, 100].map((value) => (
          <g key={value}>
            <line x1="26" x2="556" y1={y(value)} y2={y(value)} />
            <text x="18" y={y(value) + 4} textAnchor="end">{value}%</text>
          </g>
        ))}
        {period === 'quarter' && <>
          <line className="mod-chart-divider" x1={x(3) - 34} x2={x(3) - 34} y1="22" y2="145" />
          <line className="mod-chart-divider" x1={x(7) - 20} x2={x(7) - 20} y1="22" y2="145" />
        </>}
        {segments.map((segment, index) => (
          <g key={index}>
            <path d={`M${segment[0][0]},120 L${segment.map((point) => point.join(',')).join(' L')} L${segment.at(-1)[0]},120 Z`} fill="url(#presenceEvolutionFill)" />
            <polyline points={segment.map((point) => point.join(',')).join(' ')} />
          </g>
        ))}
        {values.map((value, index) => (
          <g key={labels[index]}>
            {value !== null && <>
              <circle cx={x(index)} cy={y(value)} r="3.6" />
              <text className="mod-chart-value" x={x(index)} y={y(value) - 9} textAnchor="middle">{Math.round(value)}%</text>
            </>}
            <text x={x(index)} y="150" textAnchor="middle">{labels[index]}</text>
          </g>
        ))}
        {captions.map((caption) => (
          <text key={caption.label} className="mod-chart-caption" x={caption.x} y="170" textAnchor="middle">{caption.label}</text>
        ))}
      </svg>
    </article>
  );
}

export default function DailyAttendanceOverview({ day, history, analysisDate,
  baseEmployees, baseMonthDate, onOpen, target, message, translate: t, locale, productionLabels }) {
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
            <RatePanel tone="red" title={t('daily.overview.absentTitle')} value={formatRate(modAbsentRate, locale)} label={t('daily.overview.absentRate')} delta={t('daily.overview.absentDelta')} previous={t('daily.overview.previousMonth')} icon="clock" />
            <RatePanel tone="green" title={t('daily.overview.modRateTitle')} value={formatRate(modRate || targetCoverage, locale)} label={t('daily.overview.presenceRate')} delta={t('daily.overview.presenceDelta')} previous={t('daily.overview.previousMonth')} icon="chart" />
          </div>
        </div>

        <PresenceEvolutionChart history={history} analysisDate={analysisDate} currentRate={modRate || targetCoverage} locale={locale} translate={t} />
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
          <KpiCard tone="blue" label={t('kpi.stcMonth')} value={number(stc.length)} note={formatPercent(stc.length, workforce.length)} onClick={() => open(t('kpi.stcMonth'), stc)} />
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
