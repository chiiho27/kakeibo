import { describe, expect, it } from 'vitest';
import { fiscalMonths, fiscalYearOf, monthGroups, yearReport } from './report';
import type { Master } from './types';

const e = (date: string, amount: number, kubun: string, himoku = 'A') => ({ date, amount, kubun, himoku });
const item = (himoku: string, group: string, budget: number, order: number) =>
  ({ kubun: '支出（変動費）', himoku, note: '', methods: [], budget, group, order, weekly: false });

describe('年度', () => {
  it('4月始まりで3月までを1年度にする', () => {
    expect(fiscalYearOf('2027-03-31')).toBe(2026);
    expect(fiscalYearOf('2026-04-01')).toBe(2026);
    expect(fiscalMonths(2026)[0]).toBe('2026-04');
    expect(fiscalMonths(2026)[11]).toBe('2027-03');
  });
});

describe('年間の集計', () => {
  it('特別費は支出に含め、積立は支出に含めない', () => {
    const r = yearReport([e('2026-04-01', 1000, '収入'), e('2026-05-01', 300, '支出（特別費）'), e('2026-05-02', 200, '先取り貯金・投資'), e('2026-03-31', 999, '収入')], 2026);
    expect(r.total).toEqual({ income: 1000, expense: 300, saving: 200, balance: 700 });
  });
});

describe('月別表示名', () => {
  const master: Master = { methods: [], items: [item('食費', '食費・日用品', 100, 1), item('日用品', '食費・日用品', 50, 2)] };
  it('同じ表示名の費目をまとめ、マスターにない費目も残す', () => {
    const list = [e('2026-04-01', 30, '支出（変動費）', '食費'), e('2026-04-02', 20, '支出（変動費）', '日用品'), e('2026-04-03', 5, '支出（変動費）', '旧費目')];
    expect(monthGroups(master, list, '2026-04', '支出（変動費）')).toEqual([
      { group: '食費・日用品', actual: 50, budget: 150 }, { group: '旧費目', actual: 5, budget: 0 },
    ]);
  });
});

import { expenseSlices, nmdStats, weekPace } from './report';
describe('グラフとペース', () => {
  const K = '支出（変動費）';
  const e = (date: string, amount: number, himoku: string) => ({ date, amount, kubun: K, himoku });
  const master = { items: [], methods: [] };
  it('月が変わっても同じ項目は同じ色', () => {
    const list = [e('2026-10-01', 900, 'A'), e('2026-10-02', 500, 'B'), e('2026-11-01', 100, 'B')];
    expect(expenseSlices(master, list, '2026-11', K)).toEqual([{ name: 'B', amount: 100, color: '#2E8A68' }]);
  });
  it('5項目目以降はその他にまとめる', () => {
    const list = Array.from({ length: 9 }, (_, i) => e('2026-11-01', 100 - i, 'X' + i));
    const s = expenseSlices(master, list, '2026-11', K);
    expect(s).toHaveLength(5);
    expect(s[4]).toMatchObject({ name: 'その他', amount: 96 + 95 + 94 + 93 + 92 });
  });
  it('週の目安との差', () => {
    const days = ['d1', 'd2', 'd3', 'd4'];
    expect(weekPace(400, 300, days, 'd2')).toBe(100);
    expect(weekPace(400, 100, days, 'd2')).toBe(-100);
  });
  it('NMDは記録開始前を数えず、連続は今日からさかのぼる', () => {
    const list = [e('2026-11-02', 100, 'A'), e('2026-11-05', 100, 'A')];
    expect(nmdStats(list, '2026-11', '2026-11-07')).toEqual({ month: 4, lastMonth: 0, streak: 2 });
  });
});

import { weekSpend, weeklyMonthTotals } from './report';
import { weekStatus } from './budget';
import type { SheetRow } from './types';

describe('生活費の集計範囲と予算', () => {
  const master: Master = { methods: [], items: [
    { ...item('食費', '食費', 30000, 1), weekly: true },
    { ...item('外食', '外食', 12000, 2), weekly: true },
    { ...item('日用品', '日用品', 6000, 3), weekly: true },
    { ...item('こども', 'こども', 3000, 4), weekly: true },
    { ...item('娯楽', '娯楽', 3000, 5), weekly: true },
    { ...item('交際費', '交際費', 6000, 6), weekly: true },
    item('衣服', '衣服', 9000, 7), item('医療', '医療', 6000, 8),
    item('交通', '交通', 15000, 9), item('立替', '立替', 0, 10), item('その他', 'その他', 0, 11),
  ] };
  const row = (date: string, himoku: string, amount: number, kubun = '支出（変動費）'): SheetRow =>
    ({ id: date + himoku, date, himoku, amount, kubun, method: '', g: '', sat: '', source: '' });
  const rows = [row('2026-11-02', '食費', 3200), row('2026-11-04', '立替', 5000), row('2026-11-08', 'その他', 600),
    row('2026-11-09', '衣服', 8000), row('2026-11-10', '医療', 2600), row('2026-11-11', '交通', 1800),
    row('2026-11-30', '食費', 100), row('2026-12-01', '食費', 999), row('2026-11-03', '食費', 500, '収入')];

  it('シートと同じ6費目で予算と実績を集計し、対象外5費目を月全体には残す', () => {
    const weeks = weekSpend(master, rows, '2026-11', '2026-11-24');
    expect(weeks[1]).toMatchObject({ spent: 3200, budget: 14000 });
    expect(weeks[4]).toMatchObject({ label: '11/23〜30', spent: 100, budget: 16000, current: true });
    expect(weeklyMonthTotals(master, rows, '2026-11')).toEqual({ budget: 60000, actual: 3300, left: 56700 });
    expect(monthGroups(master, rows, '2026-11', '支出（変動費）').reduce((n, g) => n + g.budget, 0)).toBe(90000);
    expect(weeks.reduce((n, w) => n + w.spent, 0)).toBe(3300);
    for (const day of ['2026-11-01', '2026-11-02', '2026-11-09', '2026-11-16', '2026-11-30']) {
      const home = weekStatus(master, rows, [], day);
      const report = weekSpend(master, rows, '2026-11', day).find(w => w.current)!;
      expect(report.budget).toBeCloseTo(home.budget);
      expect(report.spent).toBe(home.confirmed);
    }
  });

  it('週の超過を翌週へ繰り越さず、月の残予算には反映する', () => {
    const overspent = [row('2026-11-01', '日用品', 5000)];
    const weeks = weekSpend(master, overspent, '2026-11', '2026-11-02');
    expect(weeks[0].budget - weeks[0].spent).toBe(-3000);
    expect(weeks[1].budget).toBe(14000);
    expect(weeklyMonthTotals(master, overspent, '2026-11').left).toBe(55000);
  });

  it('過去月の固定予算と0円予算を尊重する', () => {
    const frozen = { 食費: 15000, 外食: 0 };
    const weeks = weekSpend(master, rows, '2026-11', '2026-11-24', frozen);
    expect(weeklyMonthTotals(master, rows, '2026-11', frozen).budget).toBe(33000);
    expect(weeks.reduce((n, w) => n + w.budget, 0)).toBeCloseTo(33000);
    const zeroMaster = { ...master, items: [{ ...master.items[0], budget: 0 }] };
    expect(weeklyMonthTotals(zeroMaster, rows, '2026-11')).toEqual({ budget: 0, actual: 3300, left: -3300 });
  });

  it('週管理対象なしと未知の費目を週の予算に混ぜない', () => {
    const empty = { ...master, items: master.items.map(i => ({ ...i, weekly: false })) };
    expect(weeklyMonthTotals(empty, rows, '2026-11')).toEqual({ budget: 0, actual: 0, left: 0 });
    expect(weekSpend(empty, rows, '2026-11', '2026-11-24').every(w => w.spent === 0 && w.budget === 0)).toBe(true);
    expect(weeklyMonthTotals(master, [row('2026-11-01', '旧費目', 999)], '2026-11').actual).toBe(0);
  });
});
