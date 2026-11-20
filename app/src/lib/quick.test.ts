import { describe, expect, it } from 'vitest';
import { kanjiNumber, parseQuick, type QuickContext } from './quick';
import { weekSpend } from './report';
import type { SheetRow } from './types';

const ctx: QuickContext = {
  today: '2026-11-20',
  methods: ['三井住友VISAカード(C)', 'PayPay', '現金', 'Suica'],
  himoku: [
    { kubun: '支出（変動費）', himoku: '🍙 食費' }, { kubun: '支出（変動費）', himoku: '☕ 外食・カフェ' },
    { kubun: '支出（変動費）', himoku: '🧴 日用品' }, { kubun: '収入', himoku: '給与' },
  ],
  history: [{ place: 'ドラッグストアA', kubun: '支出（変動費）', himoku: '🧴 日用品' }],
};

describe('ひとことで入力', () => {
  it('漢数字', () => {
    expect(kanjiNumber('千二百')).toBe(1200);
    expect(kanjiNumber('1万2000')).toBe(12000);
    expect(kanjiNumber('三千五百八十')).toBe(3580);
    expect(kanjiNumber('580')).toBe(580);
  });
  it('金額・支払方法・詳細', () => {
    expect(parseQuick('コンビニ 580円 カード', ctx)).toEqual({ amount: 580, method: '三井住友VISAカード(C)', place: 'コンビニ' });
  });
  it('費目名を言えばその費目、言い換えの支払方法', () => {
    const r = parseQuick('昨日 外食・カフェ 1,200円 ペイペイ', ctx);
    expect(r).toMatchObject({ amount: 1200, date: '2026-11-19', method: 'PayPay', himoku: '☕ 外食・カフェ', kubun: '支出（変動費）' });
    expect(r.place).toBeUndefined();
  });
  it('過去の詳細から費目を推測する', () => {
    expect(parseQuick('ドラッグストアAで千二百円 現金', ctx)).toMatchObject({ amount: 1200, method: '現金', place: 'ドラッグストアA', himoku: '🧴 日用品' });
  });
  it('日付の言い方と、円のない数字', () => {
    expect(parseQuick('11月3日 スイカ 160', ctx)).toMatchObject({ date: '2026-11-03', amount: 160, method: 'Suica' });
    expect(parseQuick('おととい 食費 980円', ctx)).toMatchObject({ date: '2026-11-18', amount: 980, himoku: '🍙 食費' });
  });
});

describe('週ごとの変動費', () => {
  const r = (date: string, amount: number, kubun = '支出（変動費）'): SheetRow => ({ id: date + amount, date, amount, kubun, himoku: '食費', method: '', g: '', sat: '', source: '' });
  it('月曜はじまりで区切り、週の予算は日数割り', () => {
    // 2026年11月1日は日曜
    const w = weekSpend([r('2026-11-01', 500), r('2026-11-02', 1000), r('2026-11-02', 300, '収入')], '2026-11', 30000, '2026-11-20');
    expect(w[0]).toMatchObject({ label: '11/1', spent: 500, budget: 1000, future: false });
    expect(w[1]).toMatchObject({ label: '11/2〜8', spent: 1000, budget: 7000 });
    expect(w.find(x => x.current)!.label).toBe('11/16〜22');
    expect(w.reduce((n, x) => n + x.budget, 0)).toBe(30000);
  });
});
