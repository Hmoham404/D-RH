import { useState } from 'react';
import DashboardIcon from './DashboardIcon';
import { getPayrollPeriod, splitPayrollWeeks } from '../lib/pointagePeriod.js';

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
    const payroll = getPayrollPeriod(analysisDate || current.toISOString().slice(0, 10));
    const weeks = splitPayrollWeeks(payroll.dates.map((isoDate) => ({ isoDate })));
    return {
      labels: weeks.map((week, index) => `S${index + 1}`),
      values: weeks.map((week) => average(sorted.filter((day) => day.isoDate >= payroll.start && day.isoDate <= payroll.end
        && day.isoDate >= week.start && day.isoDate <= week.end).map((day) => getModRateFromDay(day)?.value))),
      captions: [{ x: 292, label: `${payroll.start.split('-').reverse().join('/')} – ${payroll.end.split('-').reverse().join('/')}` }],
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

export default function PayrollPresenceChart({ history = [], analysisDate, locale, translate }) {
  const [period, setPeriod] = useState('quarter');
  const dataset = buildChartDataset(history, analysisDate, period, locale, translate);
  const labels = dataset.labels.length ? dataset.labels : ['MOD'];
  const values = (dataset.values.length ? dataset.values : [null]).map((value) => value ?? null);
  const captions = dataset.captions;
  const plottableValues = values.map((value) => Number.isFinite(value) ? value : null);
  const x = (index) => 48 + index * 492 / Math.max(1, values.length - 1);
  const y = (value) => 210 - value * 1.5;
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
      <svg viewBox="0 0 570 300" role="img" aria-label={values.map((value, index) => `${labels[index]}: ${value === null ? 'sans donnees' : `${Math.round(value)}%`}`).join(', ')}>
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
          <line className="mod-chart-divider" x1={x(3) - 34} x2={x(3) - 34} y1="42" y2="240" />
          <line className="mod-chart-divider" x1={x(7) - 20} x2={x(7) - 20} y1="42" y2="240" />
        </>}
        {segments.map((segment, index) => (
          <g key={index}>
            <path d={`M${segment[0][0]},210 L${segment.map((point) => point.join(',')).join(' L')} L${segment.at(-1)[0]},210 Z`} fill="url(#presenceEvolutionFill)" />
            <polyline points={segment.map((point) => point.join(',')).join(' ')} />
          </g>
        ))}
        {values.map((value, index) => (
          <g key={index}>
            {value !== null && <>
              <circle cx={x(index)} cy={y(value)} r="3.6" />
              <text className="mod-chart-value" x={x(index)} y={y(value) - 9} textAnchor="middle">{Math.round(value)}%</text>
            </>}
            <text x={x(index)} y="248" textAnchor="middle">{labels[index]}</text>
          </g>
        ))}
        {captions.map((caption) => (
          <text key={caption.label} className="mod-chart-caption" x={caption.x} y="278" textAnchor="middle">{caption.label}</text>
        ))}
      </svg>
    </article>
  );
}

