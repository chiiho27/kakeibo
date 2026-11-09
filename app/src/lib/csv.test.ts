import { describe, expect, it } from 'vitest';
import type { CsvItem } from './api';
import { initialChoice, needsReview, toApply } from './csv';
import { DemoApi } from './demo';

const item = (p: Partial<CsvItem>): CsvItem => ({ importId: 'a', date: '2026-11-01', merchant: 'A', amount: 100, method: 'M', kubun: '支出（変動費）', himoku: '🍙 食費',
  sat: 'ー', j: '', status: '要確認', reason: '', looseRows: [], looseSure: false, ...p });

describe('CSVの初期選択', () => {
  it('未記録で費目があれば登録', () => {
    expect(needsReview(item({}))).toBe(false);
    expect(initialChoice(item({})).action).toBe('add');
  });
  it('費目が空なら確認対象で、選ぶまで送らない', () => {
    const i = item({ himoku: '' }), c = initialChoice(i);
    expect(needsReview(i)).toBe(true);
    expect(toApply(i, { action: 'add', key: c.key })).toBeNull();
  });
  it('1対1の記録済み候補は記録済みを初期選択し、支出を増やさない', () => {
    expect(initialChoice(item({ j: '記録済候補' })).action).toBe('recorded');
    const i = item({ looseRows: [12], looseSure: true });
    expect(toApply(i, initialChoice(i))).toEqual({ importId: 'a', action: 'recorded', rawRow: 12 });
  });
  it('複数候補・返金は自動で決めない', () => {
    expect(initialChoice(item({ j: '記録済候補（複数）' })).action).toBe('');
    expect(initialChoice(item({ looseRows: [1, 2] })).action).toBe('');
    expect(initialChoice(item({ amount: -500 })).action).toBe('');
  });
  it('重複候補をあえて登録するときは別取引として送る', () => {
    const i = item({ j: '取込内重複候補' });
    expect(toApply(i, { action: 'add', key: '支出（変動費）|🍙 食費' })?.action).toBe('force');
  });
});

describe('CSVの読込', () => {
  it('同じ明細を読み直しても増えない', async () => {
    const api = new DemoApi();
    const first = await api.csvRead();
    const again = await api.csvRead();
    expect(again).toEqual({ added: 0, skipped: first.added, errors: [] });
    expect((await api.csvList()).length).toBe(first.added);
  });
  it('反映の再送で取引が増えない。記録済み・対象外は増やさない', async () => {
    const api = new DemoApi(); await api.csvRead();
    const before = api.rows.length;
    const items = [{ importId: 'demo-1', action: 'add' as const, kubun: '支出（変動費）', himoku: '🍙 食費' }, { importId: 'demo-4', action: 'recorded' as const }, { importId: 'demo-3', action: 'exclude' as const }];
    await api.csvApply(items);
    const again = await api.csvApply(items);
    expect(again.every(r => r.repeated)).toBe(true);
    expect(api.rows.length).toBe(before + 1);
  });
});
