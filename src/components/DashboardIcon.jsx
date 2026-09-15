export default function DashboardIcon({ type = 'people' }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {type === 'clock' ? <><circle cx="12" cy="12" r="9" /><path d="M12 6v6l4 2" /></>
      : type === 'file' ? <><path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6" /></>
        : <><circle cx="10" cy="7" r="3" /><path d="M4 21v-4a6 6 0 0 1 12 0v4zM17 4a3 3 0 0 1 0 6" />{type === 'recruit' ? <path d="M20 14v6m-3-3h6" /> : <path d="M19 13a5 5 0 0 1 3 5v3h-3" />}</>}
  </svg>;
}
