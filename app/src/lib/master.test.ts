import { describe, expect, it } from 'vitest';
import { diffOps } from '../ui/MasterEdit';

const item = { kubun: '支出（変動費）', row: 33, himoku: '🍙 食費', group: '🍙 食費', order: 1, budget: 100, weekly: true, hidden: false };
const draft = { order: '1', budget: '100', weekly: true, hidden: false };

describe('設定の差分', () => {
  it('変更がなければ何も送らない', () => expect(diffOps(item, draft)).toEqual([]));
  it('予算は変更前の値を付けて送る', () => {
    expect(diffOps(item, { ...draft, budget: '120' })).toEqual([{ kubun: item.kubun, row: 33, himoku: item.himoku, type: 'budget', from: 100, to: 120 }]);
  });
});
