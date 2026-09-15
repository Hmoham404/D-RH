import { useId, useState } from 'react';
import DashboardIcon from './DashboardIcon';

export default function AttendanceCharts({ history = [], analysisDate, absent, late, stc, locale, translate: t }) {
  const [range, setRange] = useState(7);
  const gradientId = useId().replace(/:/g, '');
  const end = analysisDate ? new Date(`${analysisDate}T12:00:00Z`) : null;
  const points = end ? Array.from({ length: range }, (_, index) => {
    const date = new Date(end);
    date.setUTCDate(date.getUTCDate() - range + index + 1);
    const isoDate = date.toISOString().slice(0, 10);
    const day = history.find((item) => item.isoDate === isoDate);
    const total = day?.departments.reduce((sum, group) => sum + group.expected, 0) || 0;
    const present = day?.departments.reduce((sum, group) => sum + group.present, 0) || 0;
    return { isoDate, value: total ? present / total * 100 : null, label: date.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', timeZone: 'UTC' }) };
  }) : [];
  const x = (index) => 48 + index * 492 / (range - 1);
  const y = (value) => 112 - value * 0.86;
  const segments = [];
  points.forEach((point, index) => {
    if (point.value === null) return;
    if (index === 0 || points[index - 1].value === null) segments.push([]);
    segments.at(-1).push([x(index), y(point.value)]);
  });
  const events = [
    { label: t('kpi.absents'), value: absent, color: '#ff8b32' },
    { label: t('kpi.late'), value: late, color: '#ff5479' },
    { label: t('kpi.stcMonth'), value: stc, color: '#3689fb' },
  ];
  const maximum = Math.max(5, Math.ceil(Math.max(...events.map((event) => event.value)) / 5) * 5);
  return <>
    <article className="attendance-chart attendance-chart--trend">
      <header><h3><DashboardIcon type="clock" />{t('daily.trendTitle', 'Évolution de la présence')}</h3><select aria-label={t('daily.trendPeriod', 'Période du graphique')} value={range} onChange={(event) => setRange(Number(event.target.value))}><option value={7}>7 {t('daily.days', 'jours')}</option><option value={14}>14 {t('daily.days', 'jours')}</option></select></header>
      {points.some((point) => point.value !== null) ? <svg viewBox="0 0 570 145" role="img" aria-label={points.map((point) => `${point.label}: ${point.value === null ? t('daily.noData', 'sans données') : `${point.value.toFixed(1)} %`}`).join(', ')}>
        <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#48b3fa" stopOpacity=".4" /><stop offset="100%" stopColor="#48b3fa" stopOpacity=".03" /></linearGradient></defs>
        {[0, 25, 50, 75, 100].map((value) => <g key={value}><line x1="40" x2="550" y1={y(value)} y2={y(value)} stroke="#e9eff6" /><text x="32" y={y(value) + 4} textAnchor="end">{value}%</text></g>)}
        {segments.map((segment, index) => <g key={index}><path d={`M${segment[0][0]},112 L${segment.map((pair) => pair.join(',')).join(' L')} L${segment.at(-1)[0]},112 Z`} fill={`url(#${gradientId})`} /><polyline points={segment.map((pair) => pair.join(',')).join(' ')} fill="none" stroke="#2187fa" strokeWidth="2.5" /></g>)}
        {points.map((point, index) => <g key={point.isoDate}>{point.value !== null && <><circle cx={x(index)} cy={y(point.value)} r="3.7" fill="#2187fa" stroke="white" /><text className="attendance-chart__value" x={x(index)} y={y(point.value) - 10} textAnchor="middle">{Math.round(point.value)}%</text></>}<text x={x(index)} y="135" textAnchor="middle">{range === 7 || index % 2 === 0 ? point.label : ''}</text></g>)}
      </svg> : <p className="attendance-chart__empty">{t('daily.noChartData', 'Importez un pointage pour afficher la courbe.')}</p>}
      {points.some((point) => point.value === null) && <small>{t('daily.missingDays', 'Jours sans pointage importé : données indisponibles.')}</small>}
    </article>
    <article className="attendance-chart attendance-chart--events">
      <header><h3><DashboardIcon type="file" />{t('daily.eventsTitle', 'Absences, retards et départs')}</h3></header>
      <svg viewBox="0 0 570 145" role="img" aria-label={events.map((event) => `${event.label}: ${event.value}`).join(', ')}>
        {[0, 1, 2, 3, 4].map((tick) => <g key={tick}><line x1="40" x2="550" y1={112 - tick * 22} y2={112 - tick * 22} stroke="#e9eff6" /><text x="30" y={116 - tick * 22} textAnchor="end">{Math.round(maximum * tick / 4)}</text></g>)}
        {events.map((event, index) => { const height = event.value / maximum * 88; return <g key={event.label}><rect x={80 + index * 168} y={112 - height} width="84" height={height} rx="3" fill={event.color} /><text className="attendance-chart__value" x={122 + index * 168} y={104 - height} textAnchor="middle">{event.value}</text><text x={122 + index * 168} y="132" textAnchor="middle">{event.label}</text></g>; })}
      </svg>
      <small>{t('daily.eventsPeriod', 'Absences et retards : journée sélectionnée · STC : mois courant')}</small>
    </article>
  </>;
}
