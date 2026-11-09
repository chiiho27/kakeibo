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
