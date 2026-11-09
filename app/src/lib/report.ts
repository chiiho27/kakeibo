import { monthTotals, type MonthTotals } from './budget';
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
