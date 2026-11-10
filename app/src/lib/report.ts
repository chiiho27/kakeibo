import { monthTotals, type MonthTotals } from './budget';
import { isNoMoneyDay } from './budget';
import { daysInMonth, ymd } from './date';
import type { Master } from './types';

type Entry = { date: string; amount: number; kubun: string; himoku: string };

/** 特別費管理シートの値をそのまま持つ。アプリでは残高を計算しない。読めない項目は null（未設定）。 */
export interface SpecialFund {
  balance: number | null;     // 今使える確保残高
  outside: number | null;     // 積立以外からの支出
  planned: number | null;     // 年間予定額
  actual: number | null;      // 年間支出実績
  monthlyPlan: number | null; // 毎月の積立計画
  saved: number | null;       // 実際の積立（開始後）
  used: number | null;        // 積立から充当（開始後）
  months: { label: string; plan: number | null; actual: number | null }[];
}

/** 固定済みの月の予算（月 → 月別表示名 → 金額）。スプレッドシートの月シートの値。 */
export type FrozenBudgets = Record<string, Record<string, number>>;

/** 年度は4月始まり（特別費管理の年度開始日・年間推移と同じ）。 */
export const fiscalYearOf = (ymd: string) => {
  const [y, m] = ymd.split('-').map(Number);
  return m >= 4 ? y : y - 1;
};

export const fiscalMonths = (fy: number) =>
  Array.from({ length: 12 }, (_, i) => {
    const m = ((i + 3) % 12) + 1;
    return `${m >= 4 ? fy : fy + 1}-${String(m).padStart(2, '0')}`;
  });

export interface YearReport { months: (MonthTotals & { ym: string })[]; total: MonthTotals }

export function yearReport(list: Entry[], fy: number): YearReport {
  const months = fiscalMonths(fy).map(ym => ({ ym, ...monthTotals(list, ym) }));
  const add = (k: keyof MonthTotals) => months.reduce((s, m) => s + m[k], 0);
  return { months, total: { income: add('income'), expense: add('expense'), saving: add('saving'), balance: add('balance') } };
}

export interface GroupLine { group: string; actual: number; budget: number }

/** 区分の中を「月別表示名」でまとめる。マスターにない過去の費目も、費目名のまま残す。 */
export function monthGroups(master: Master, list: Entry[], ym: string, kubun: string): GroupLine[] {
  const lines = new Map<string, GroupLine>();
  const line = (group: string) => {
    if (!lines.has(group)) lines.set(group, { group, actual: 0, budget: 0 });
    return lines.get(group)!;
  };
  const items = master.items.filter(i => i.kubun === kubun).sort((a, b) => a.order - b.order);
  items.forEach(i => { line(i.group).budget += i.budget; });
  list.filter(e => e.kubun === kubun && e.date.startsWith(ym)).forEach(e => {
    line(items.find(i => i.himoku === e.himoku)?.group ?? e.himoku).actual += e.amount;
  });
  return [...lines.values()].filter(l => l.actual !== 0 || l.budget !== 0);
}

// グラフの色。色覚の違いでも隣同士を見分けられることを確認済み。文字の色には使わない。
export const CHART_COLORS = ['#A85A32', '#2E8A68', '#D9A036', '#4D74B5'];
export const CHART_OTHER = '#B9AFA6';
export const CHART_INCOME = '#2E8A68';
export const CHART_EXPENSE = '#A85A32';

export interface Slice { name: string; amount: number; color: string }

/** 円グラフの内訳。色は全期間の支出の多い順で決め、月を変えても同じ項目は同じ色にする。5項目目以降は「その他」。 */
export function expenseSlices(master: Master, list: Entry[], ym: string, kubun: string): Slice[] {
  const groupOf = (h: string) => master.items.find(i => i.kubun === kubun && i.himoku === h)?.group ?? h;
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  const all = new Map<string, number>(), month = new Map<string, number>();
  list.filter(e => e.kubun === kubun).forEach(e => {
    add(all, groupOf(e.himoku), e.amount);
    if (e.date.startsWith(ym)) add(month, groupOf(e.himoku), e.amount);
  });
  const top = [...all.entries()].sort((a, b) => b[1] - a[1]).slice(0, CHART_COLORS.length).map(x => x[0]);
  const out: Slice[] = top.flatMap((name, i) => (month.get(name) ?? 0) > 0 ? [{ name, amount: month.get(name)!, color: CHART_COLORS[i] }] : []);
  const other = [...month.entries()].filter(([k, v]) => !top.includes(k) && v > 0).reduce((s, x) => s + x[1], 0);
  return other > 0 ? [...out, { name: 'その他', amount: other, color: CHART_OTHER }] : out;
}

/** 今日までの目安との差。プラスなら目安より少なく使えている。 */
export function weekPace(budget: number, left: number, days: string[], day: string): number {
  const elapsed = Math.max(days.indexOf(day) + 1, 1);
  return Math.round((budget * elapsed) / days.length - (budget - left));
}

/** ノーマネーデーの日数。記録を始める前の日は数えない。 */
export function nmdStats(list: Entry[], ym: string, day: string) {
  const first = list.reduce((m, e) => (e.date < m ? e.date : m), '9999');
  const count = (y: number, mo: number) => Array.from({ length: daysInMonth(y, mo) }, (_, i) => ymd(y, mo, i + 1))
    .filter(d => d >= first && isNoMoneyDay(list, d, day) === true).length;
  const [y, m] = ym.split('-').map(Number);
  const [ty, tm, td] = day.split('-').map(Number);
  let streak = 0;
  for (let i = 0; i < 366; i++) {
    const t = new Date(ty, tm - 1, td - i), d = ymd(t.getFullYear(), t.getMonth() + 1, t.getDate());
    if (d < first || isNoMoneyDay(list, d, day) !== true) break;
    streak++;
  }
  return { month: count(y, m), lastMonth: m === 1 ? count(y - 1, 12) : count(y, m - 1), streak };
}
