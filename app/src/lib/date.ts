// 日付は 'YYYY-MM-DD' 文字列のまま扱う。new Date('YYYY-MM-DD') は UTC 扱いで前日にずれるため使わない。

const pad = (n: number) => String(n).padStart(2, '0');

export const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** 端末の現地時刻での今日 */
export function today(now = new Date()): string {
  return ymd(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function parts(s: string): [number, number, number] {
  const [y, m, d] = s.split('-').map(Number);
  return [y, m, d];
}

/** 画面表示用 yyyy/mm/dd */
export const slash = (s: string) => s.replace(/-/g, '/');

export const daysInMonth = (y: number, m: number) => new Date(y, m, 0).getDate();

/** 月曜=0 … 日曜=6 */
export function weekdayMon(s: string): number {
  const [y, m, d] = parts(s);
  return (new Date(y, m - 1, d).getDay() + 6) % 7;
}

export function isValidYmd(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = parts(s);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

export interface Week { n: number; days: string[] }

/**
 * スプレッドシートと同じ週の区切り：月曜始まり、月初の端数週は1週目、
 * 6週目にあたる日は5週目に含める。
 */
export function weeksOfMonth(y: number, m: number): Week[] {
  const first = ymd(y, m, 1);
  const offset = weekdayMon(first);
  const weeks: Week[] = [];
  for (let d = 1; d <= daysInMonth(y, m); d++) {
    const n = Math.min(5, Math.floor((d - 1 + offset) / 7) + 1);
    (weeks[n - 1] ||= { n, days: [] }).days.push(ymd(y, m, d));
  }
  return weeks;
}

export function weekOf(s: string): Week {
  const [y, m] = parts(s);
  return weeksOfMonth(y, m).find(w => w.days.includes(s))!;
}
