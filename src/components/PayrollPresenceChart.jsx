import { useState } from 'react';
import DashboardIcon from './DashboardIcon';
import { getPayrollPeriod, splitPayrollWeeks } from '../lib/pointagePeriod.js';
import { buildPayrollAbsenceDataset, getAbsenceTargetBand, MOD_ABSENCE_TARGET } from '../lib/presenceTrend.js';

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

export default function PayrollPresenceChart({ history = [], analysisDate, payrollPeriod, locale, translate }) {
  const [period, setPeriod] = useState('quarter');
  const [metric, setMetric] = useState('presence');
  const isAbsence = metric === 'absence';
  const activePayrollPeriod = payrollPeriod || getPayrollPeriod(analysisDate || undefined);
  const absencePoints = isAbsence ? buildPayrollAbsenceDataset(history, activePayrollPeriod) : [];
  const presenceDataset = isAbsence ? null : buildChartDataset(history, analysisDate, period, locale, translate);
  const chartDates = isAbsence ? absencePoints.map((point) => point.isoDate) : [];
  const absenceLabels = chartDates.map((isoDate, index) => {
    const date = getUtcDate(isoDate);
    const day = date.getUTCDate();
    const fullDate = index === 0 || day === 1 || index === chartDates.length - 1;
    const nearFullDate = chartDates.some((other, otherIndex) => Math.abs(otherIndex - index) <= 1
      && (otherIndex === 0 || getUtcDate(other).getUTCDate() === 1 || otherIndex === chartDates.length - 1));
    if (!fullDate && (index % 4 !== 0 || nearFullDate)) return '';
    return fullDate
      ? new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(date)
      : String(day).padStart(2, '0');
  });
  const labels = isAbsence ? absenceLabels : (presenceDataset.labels.length ? presenceDataset.labels : ['MOD']);
  const values = isAbsence ? absencePoints.map((point) => point.value) : (presenceDataset.values.length ? presenceDataset.values : [null]);
  const captions = isAbsence ? [] : presenceDataset.captions;
  const plottableValues = values.map((value) => Number.isFinite(value) ? value : null);
  const x = (index) => 48 + index * 492 / Math.max(1, values.length - 1);
  const observedMax = Math.max(MOD_ABSENCE_TARGET * 2, ...plottableValues.filter(Number.isFinite));
  const yMax = isAbsence ? Math.min(100, Math.ceil(observedMax / 5) * 5) : 100;
  const y = (value) => 210 - value / yMax * 150;
  const yTicks = isAbsence ? [0, 0.25, 0.5, 0.75, 1].map((fraction) => yMax * fraction) : [0, 25, 50, 75, 100];
  const formatRate = (value) => `${Number(value.toFixed(isAbsence ? 1 : 0)).toLocaleString(locale)}%`;
  const periods = [
    { key: 'quarter', label: translate('daily.overview.quarter') },
    { key: 'month', label: translate('daily.overview.month') },
    { key: 'week', label: translate('daily.overview.week') },
  ];
  const periodStart = activePayrollPeriod.start;
  const periodEnd = activePayrollPeriod.end;
  const payrollRange = (date) => new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(getUtcDate(date));
  const targetBand = (value) => getAbsenceTargetBand(value);
  const segments = [];
  plottableValues.forEach((value, index) => {
    if (value === null) return;
    if (index === 0 || plottableValues[index - 1] === null) segments.push([]);
    segments.at(-1).push([x(index), y(value), value]);
  });

  return (
    <article className="mod-presence-chart">
      <header>
        <div>
          <span className="mod-section-icon"><DashboardIcon type="chart" /></span>
          <div>
            <h2>{translate(isAbsence ? 'daily.overview.evolutionAbsence' : 'daily.overview.evolution')}</h2>
          </div>
        </div>
        <div className="mod-chart-controls">
          <div className="mod-chart-modes" role="group" aria-label={translate('daily.overview.curveMetricAria')}>
          {[
            { key: 'presence', label: translate('daily.overview.attendanceCurve') },
            { key: 'absence', label: translate('daily.overview.absenceCurve') },
          ].map((tab) => (
            <button
              key={tab.key}
              className={metric === tab.key ? 'is-active' : ''}
              type="button"
              aria-pressed={metric === tab.key}
              onClick={() => setMetric(tab.key)}
            >
              {tab.label}
            </button>
          ))}
          </div>
          {isAbsence ? <div className="mod-chart-absence-meta">
            <span className="mod-chart-target-key"><i />{translate('daily.overview.absenceTarget')} <strong>5%</strong></span>
            <span>{translate('daily.overview.payrollCycle')}: {payrollRange(periodStart)} – {payrollRange(periodEnd)}</span>
          </div> : <div className="mod-chart-tabs" aria-label={translate('daily.overview.periodAria')}>
            {periods.map((tab) => (
              <button key={tab.key} className={period === tab.key ? 'is-active' : ''} type="button"
                aria-pressed={period === tab.key} onClick={() => setPeriod(tab.key)}>{tab.label}</button>
            ))}
          </div>}
        </div>
      </header>
      <svg viewBox="0 0 570 300" role="img" aria-label={values.map((value, index) => `${isAbsence ? chartDates[index] : labels[index]}: ${value === null ? 'sans donnees' : formatRate(value)}`).join(', ')}>
        <defs>
          <linearGradient id="presenceEvolutionFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2f80ed" stopOpacity=".32" />
            <stop offset="100%" stopColor="#2f80ed" stopOpacity=".04" />
          </linearGradient>
          <linearGradient id="absenceEvolutionFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f59e0b" stopOpacity=".18" />
            <stop offset="100%" stopColor="#f59e0b" stopOpacity=".015" />
          </linearGradient>
        </defs>
        {yTicks.map((value) => (
          <g key={value}>
            <line x1="26" x2="556" y1={y(value)} y2={y(value)} />
            <text x="18" y={y(value) + 4} textAnchor="end">{formatRate(value)}</text>
          </g>
        ))}
        {isAbsence && <g className="mod-chart-target">
          <line x1="26" x2="556" y1={y(MOD_ABSENCE_TARGET)} y2={y(MOD_ABSENCE_TARGET)} />
          <rect x="518" y={y(MOD_ABSENCE_TARGET) - 10} width="37" height="18" rx="5" />
          <text x="536.5" y={y(MOD_ABSENCE_TARGET) + 3} textAnchor="middle">5%</text>
        </g>}
        {!isAbsence && period === 'quarter' && <>
          <line className="mod-chart-divider" x1={x(3) - 34} x2={x(3) - 34} y1="42" y2="240" />
          <line className="mod-chart-divider" x1={x(7) - 20} x2={x(7) - 20} y1="42" y2="240" />
        </>}
        {segments.map((segment, index) => (
          <g key={index}>
            <path d={`M${segment[0][0]},210 L${segment.map((point) => `${point[0]},${point[1]}`).join(' L')} L${segment.at(-1)[0]},210 Z`}
              fill={`url(#${isAbsence ? 'absenceEvolutionFill' : 'presenceEvolutionFill'})`} />
            {isAbsence ? segment.slice(1).map((point, indexInSegment) => {
              const previous = segment[indexInSegment];
              const band = targetBand((point[2] + previous[2]) / 2);
              return <line key={`${index}-${indexInSegment}`} className={`mod-chart-absence-line mod-chart-absence-line--${band}`}
                x1={previous[0]} y1={previous[1]} x2={point[0]} y2={point[1]} />;
            }) : <polyline points={segment.map((point) => `${point[0]},${point[1]}`).join(' ')} />}
          </g>
        ))}
        {values.map((value, index) => (
          <g key={index}>
            {value !== null && <>
              <circle className={isAbsence ? `mod-chart-absence-point mod-chart-absence-point--${targetBand(value)}` : ''}
                cx={x(index)} cy={y(value)} r="3.6" />
              <text className={`mod-chart-value${isAbsence ? ` mod-chart-value--${targetBand(value)}` : ''}`}
                x={x(index)} y={y(value) - 9} textAnchor="middle">{formatRate(value)}</text>
            </>}
            {labels[index] && <text className={isAbsence ? 'mod-chart-date-label' : ''} x={x(index)} y="248" textAnchor="middle">{labels[index]}</text>}
          </g>
        ))}
        {captions.map((caption) => (
          <text key={caption.label} className="mod-chart-caption" x={caption.x} y="278" textAnchor="middle">{caption.label}</text>
        ))}
      </svg>
    </article>
  );
}

