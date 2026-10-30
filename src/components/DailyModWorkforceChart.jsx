import { useId } from 'react';
import DashboardIcon from './DashboardIcon';
import { buildDailyModWorkforceDataset } from '../lib/presenceTrend.js';

export default function DailyModWorkforceChart({ employees = [], analysisDate, locale, translate: t }) {
  const titleId = useId();
  const descriptionId = useId();
  const { start, end, points } = buildDailyModWorkforceDataset(employees, analysisDate || undefined);
  const number = (value) => value.toLocaleString(locale);
  const date = (value) => new Intl.DateTimeFormat(locale, {
    day: '2-digit', month: 'short', timeZone: 'UTC',
  }).format(new Date(`${value}T12:00:00Z`));
  const title = t('daily.overview.dailyModWorkforce');
  const noData = t('daily.overview.outsideAnalysis');
  const max = Math.max(4, ...points.map((point) => point.value ?? 0));
  const step = Math.max(1, Math.ceil(max / 4 / (max > 20 ? 5 : 1)) * (max > 20 ? 5 : 1));
  const yMax = step * 4;
  const x = (index) => points.length === 1 ? 300 : 48 + index * 492 / (points.length - 1);
  const y = (value) => 208 - value / yMax * 152;
  const labelStep = Math.max(1, Math.ceil((points.length - 1) / 6));
  const segments = [];
  points.forEach((point, index) => {
    if (point.value === null) return;
    if (index === 0 || points[index - 1].value === null) segments.push([]);
    segments.at(-1).push({ ...point, x: x(index), y: y(point.value) });
  });
  const pointLabel = (point) => `${date(point.isoDate)} : ${point.value === null ? noData : `${number(point.value)} ${t('daily.overview.activeMod')}`}`;

  return (
    <section className="mod-daily-presence-chart" aria-labelledby={titleId}>
      <header>
        <div>
          <span className="mod-section-icon"><DashboardIcon type="chart" /></span>
          <div><h2 id={titleId}>{title}</h2><p>{t('daily.overview.activeMod')}</p></div>
        </div>
      </header>
      <svg viewBox="0 0 570 258" role="img" aria-labelledby={`${titleId} ${descriptionId}`}>
        <desc id={descriptionId}>{points.map(pointLabel).join('; ')}</desc>
        {[0, 1, 2, 3, 4].map((index) => (
          <g key={index}>
            <line x1="32" x2="556" y1={y(index * step)} y2={y(index * step)} />
            <text x="24" y={y(index * step) + 3} textAnchor="end">{number(index * step)}</text>
          </g>
        ))}
        {segments.map((segment) => (
          <g key={segment[0].isoDate}>
            <path d={`M${segment[0].x},208 L${segment.map((point) => `${point.x},${point.y}`).join(' L')} L${segment.at(-1).x},208 Z`}
              className="mod-daily-presence-chart__area" />
            <polyline points={segment.map((point) => `${point.x},${point.y}`).join(' ')} />
          </g>
        ))}
        {points.map((point, index) => (
          <g key={point.isoDate}>
            {point.value !== null && <>
              <circle cx={x(index)} cy={y(point.value)} r="3.6" tabIndex="0" aria-label={pointLabel(point)}>
                <title>{pointLabel(point)}</title>
              </circle>
              <text className="mod-chart-value" x={x(index)} y={y(point.value) - 10} textAnchor="middle">{number(point.value)}</text>
            </>}
            {(index === 0 || index === points.length - 1 || (index % labelStep === 0 && index < points.length - 2)) &&
              <text x={x(index)} y="235" textAnchor="middle" className={index === points.length - 1 ? 'mod-daily-presence-chart__last-date' : ''}>{date(point.isoDate)}</text>}
          </g>
        ))}
        {!segments.length && <text x="295" y="126" textAnchor="middle">{t('daily.overview.dailyWorkforceEmpty')}</text>}
      </svg>
      <footer>
        <span><time dateTime={start}>{date(start)}</time> – <time dateTime={end}>{date(end)}</time></span>
        <span>{t('daily.overview.dailyWorkforceHint')}</span>
      </footer>
    </section>
  );
}
