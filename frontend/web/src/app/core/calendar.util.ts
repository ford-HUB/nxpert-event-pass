export interface CalendarEvent {
  id: number; title: string; description: string; startsAt: string; endsAt: string;
  venue: string; publicSlug: string; status: string; format: string;
  isRegistered: boolean; isInvited: boolean; canManage: boolean;
}
// UTC surrogate dates represent Philippine wall-clock coordinates, not instants.
// Rendering them with DatePipe's UTC option avoids the viewer's timezone/DST shifts.
export const dateKey = (date: Date): string => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
export const addDays = (date: Date, count: number): Date => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + count));
export const wallDate = (value: string): Date => {
  const [day, time = '00:00'] = value.split('T');
  const [y, m, d] = day.split('-').map(Number), [h, min, s = 0] = time.slice(0, 8).split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, h, min, s));
};
export function calendarDays(anchor: Date, view: 'month' | 'week'): Date[] {
  const start = view === 'month' ? new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1)) : anchor;
  const sunday = addDays(start, -start.getUTCDay());
  return Array.from({ length: view === 'month' ? 42 : 7 }, (_, i) => addDays(sunday, i));
}
export function dayEvents(events: CalendarEvent[], day: Date): CalendarEvent[] {
  const next = addDays(day, 1);
  return events.filter(e => wallDate(e.startsAt) < next && wallDate(e.endsAt) > day)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}
export function weekBlocks(events: CalendarEvent[], day: Date) {
  const next = addDays(day, 1).getTime();
  const items = dayEvents(events, day).map(event => {
    const start = Math.max(day.getTime(), wallDate(event.startsAt).getTime());
    const end = Math.min(next, wallDate(event.endsAt).getTime());
    return { event, start, end, column: 0, columns: 1, top: (start - day.getTime()) / 60000,
      height: Math.max(18, (end - start) / 60000) };
  });
  // Overlapping appointments get their own column, including transitive overlap groups.
  let group: typeof items = [], until = 0;
  const finish = () => {
    const ends: number[] = [];
    for (const item of group) {
      let column = ends.findIndex(end => end <= item.start);
      if (column === -1) column = ends.length;
      ends[column] = item.end; item.column = column;
    }
    for (const item of group) item.columns = ends.length;
  };
  for (const item of items) {
    if (group.length && item.start >= until) { finish(); group = []; }
    group.push(item); until = Math.max(group.length === 1 ? 0 : until, item.end);
  }
  finish(); return items;
}
