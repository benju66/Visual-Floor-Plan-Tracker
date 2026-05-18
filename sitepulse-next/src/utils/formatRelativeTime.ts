export function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60000);
  
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  
  return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
