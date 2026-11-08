import { daysInMonth, parts, today as todayOf, weekOf, type Week } from './date';
import { K_INC, K_SAVE, K_VAR, type Master, type NewTx, type Op, type SheetRow } from './types';

type Entry = { date: string; amount: number; kubun: string; himoku: string };

/** 未送信のうち、スプレッドシートの取得結果にまだ現れていないものだけを返す（二重計上を防ぐ） */
export function unsentTxs(ops: Op[], rows: SheetRow[]): NewTx[] {
  const ids = new Set(rows.map(r => r.id));
  return ops.filter(o => !ids.has(o.tx.id)).map(o => o.tx);
}

const sum = (list: Entry[]) => list.reduce((s, e) => s + e.amount, 0);

export interface WeekStatus {
  week: Week;
  budget: number;          // 週管理対象費目の月予算 × その週の日数 ÷ 月の日数
  confirmed: number;       // 最終取得時点のスプレッドシートの実績
  unsent: number;          // 未送信分
  left: number;            // budget − confirmed − unsent（マイナスのまま表示する）
  daysLeft: number;        // 今日を含む残り日数
  hasWeeklyItems: boolean;
}

export function weekStatus(master: Master, rows: SheetRow[], unsent: NewTx[], day = todayOf()): WeekStatus {
  const week = weekOf(day);
  const [y, m] = parts(day);
  const items = master.items.filter(i => i.kubun === K_VAR && i.weekly);
  const names = new Set(items.map(i => i.himoku));
  const budget = items.reduce((s, i) => s + i.budget, 0) * week.days.length / daysInMonth(y, m);
  const inWeek = (e: Entry) => e.kubun === K_VAR && names.has(e.himoku) && week.days.includes(e.date);
  const confirmed = sum(rows.filter(inWeek));
  const pending = sum(unsent.filter(inWeek));
  return {
    week, budget, confirmed, unsent: pending, left: budget - confirmed - pending,
    daysLeft: week.days.filter(d => d >= day).length, hasWeeklyItems: items.length > 0,
  };
}

export interface MonthTotals { income: number; expense: number; saving: number; balance: number }

/** 利用日ベースの登録済み明細の収支。積立（先取り貯金・投資）は支出と分けて示す。 */
export function monthTotals(list: Entry[], ym: string): MonthTotals {
  const inMonth = list.filter(e => e.date.startsWith(ym));
  const income = sum(inMonth.filter(e => e.kubun === K_INC));
  const saving = sum(inMonth.filter(e => e.kubun === K_SAVE));
  const expense = sum(inMonth.filter(e => e.kubun.startsWith('支出')));
  return { income, expense, saving, balance: income - expense - saving };
}

/** NMD：今日までの日で、変動費の記録合計が0円。未来日は対象外（null）。 */
export function isNoMoneyDay(list: Entry[], day: string, todayYmd = todayOf()): boolean | null {
  if (day > todayYmd) return null;
  return sum(list.filter(e => e.date === day && e.kubun === K_VAR)) === 0;
}
