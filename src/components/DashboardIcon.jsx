export default function DashboardIcon({ type = 'people' }) {
  return <svg className="size-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {type === 'grid' ? <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>
      : type === 'chart' ? <path d="M3 3v18h18M7 16v-4m5 4V7m5 9v-6" />
      : type === 'building' ? <><path d="M4 21V5h10v16M14 10h6v11M2 21h20M8 9h2M8 13h2M8 17h2M17 14h1M17 18h1" /></>
      : type === 'calendar' ? <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4m10-4v4M3 11h18m-14 4h3m4 0h3" /></>
      : type === 'upload' ? <path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5" />
      : type === 'edit' ? <path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14z" />
      : type === 'lock' ? <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>
      : type === 'clock' ? <><circle cx="12" cy="12" r="9" /><path d="M12 6v6l4 2" /></>
      : type === 'file' ? <><path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6" /></>
        : <><circle cx="10" cy="7" r="3" /><path d="M4 21v-4a6 6 0 0 1 12 0v4zM17 4a3 3 0 0 1 0 6" />{type === 'recruit' ? <path d="M20 14v6m-3-3h6" /> : <path d="M19 13a5 5 0 0 1 3 5v3h-3" />}</>}
  </svg>;
}
