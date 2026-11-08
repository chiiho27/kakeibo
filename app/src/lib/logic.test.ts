import { beforeEach, describe, expect, it } from 'vitest';
import { isNoMoneyDay, monthTotals, unsentTxs, weekStatus } from './budget';
import { isValidYmd, slash, weekOf, weeksOfMonth } from './date';
import { listOps, putOp, resetDbForTest } from './db';
import { DemoApi, demoMaster } from './demo';
import { syncNow } from './sync';
import type { Op, SheetRow } from './types';

const op = (id: string, extra: Partial<Op['tx']> = {}): Op => ({
  opId: 'op-' + id, type: 'add', state: 'pending', createdAt: Date.now(),
  tx: { id: 'tx-' + id, date: '2026-11-08', amount: 500, kubun: '支出（変動費）', himoku: '🍙 食費', method: '現金', place: '', detail: '', sat: '', ...extra },
});

describe('日付', () => {
  it('yyyy/mm/dd で表示し、文字列のまま扱う', () => {
    expect(slash('2026-11-08')).toBe('2026/11/08');
    expect(isValidYmd('2026-02-29')).toBe(false);
    expect(isValidYmd('2028-02-29')).toBe(true);
  });
  it('週は月曜始まり、6週目は5週目に含める', () => {
    // 2026年11月：1日が日曜 → 1週目は1日だけ、30日（月）は6週目にあたるので5週目へ
    const w = weeksOfMonth(2026, 11);
    expect(w).toHaveLength(5);
    expect(w[0].days).toEqual(['2026-11-01']);
    expect(w[4].days).toContain('2026-11-30');
    expect(weekOf('2026-11-08').n).toBe(2);
  });
});

describe('集計', () => {
  const rows: SheetRow[] = [
    { id: 'a', date: '2026-11-03', amount: 1000, kubun: '支出（変動費）', himoku: '🍙 食費', method: '', g: '', sat: '', source: '' },
    { id: 'b', date: '2026-11-03', amount: 9000, kubun: '支出（固定費）', himoku: '💡 電気', method: '', g: '', sat: '', source: '' },
    { id: 'c', date: '2026-11-01', amount: 300000, kubun: '収入', himoku: '💰 給与', method: '', g: '', sat: '', source: '' },
    { id: 'd', date: '2026-11-01', amount: 20000, kubun: '先取り貯金・投資', himoku: '💴 NISA', method: '', g: '', sat: '', source: '' },
  ];
  it('週予算＝週管理対象の月予算×週の日数÷月の日数。未送信は別に数える', () => {
    const s = weekStatus(demoMaster(), rows, [op('x').tx], '2026-11-04');
    const weeklyTotal = demoMaster().items.filter(i => i.weekly).reduce((t, i) => t + i.budget, 0);
    expect(s.budget).toBeCloseTo(weeklyTotal * 7 / 30);
    expect(s.confirmed).toBe(1000);
    expect(s.unsent).toBe(500);        // 未送信（11/08）も同じ週（11/02〜11/08）
    expect(s.left).toBeCloseTo(s.budget - 1500);
    expect(s.daysLeft).toBe(5);        // 11/04〜11/08
  });
  it('今月の収支は積立を支出と分ける', () => {
    expect(monthTotals(rows, '2026-11')).toEqual({ income: 300000, expense: 10000, saving: 20000, balance: 270000 });
  });
  it('NMD：変動費0円の過去日だけ。固定費だけの日もNMD、未来日は空欄', () => {
    expect(isNoMoneyDay(rows, '2026-11-03', '2026-11-08')).toBe(false);
    expect(isNoMoneyDay(rows, '2026-11-01', '2026-11-08')).toBe(true);
    expect(isNoMoneyDay([{ ...rows[1], date: '2026-11-05' }], '2026-11-05', '2026-11-08')).toBe(true);
    expect(isNoMoneyDay(rows, '2026-11-09', '2026-11-08')).toBeNull();
  });
  it('取得結果に現れた未送信は二重に数えない', () => {
    const o = op('y');
    expect(unsentTxs([o], [{ ...rows[0], id: o.tx.id }])).toHaveLength(0);
  });
});

describe('同期', () => {
  let n = 0;
  beforeEach(async () => { await resetDbForTest('t' + n++); });

  it('通常：送信後、未送信は0件。スプレッドシートに1件だけ増える', async () => {
    const api = new DemoApi(); const before = api.rows.length;
    await putOp(op('1'));
    const r = await syncNow(api);
    expect(r.sent).toBe(1);
    expect(await listOps()).toHaveLength(0);
    expect(api.rows.length).toBe(before + 1);
  });

  it('保存後に応答が途切れても、再送で増えない', async () => {
    const api = new DemoApi(); const before = api.rows.length;
    await putOp(op('2'));
    api.loseNextResponse = true;
    const first = await syncNow(api);
    expect(first.error).toBe('network');
    expect((await listOps())[0].state).toBe('unknown');
    await syncNow(api);
    expect(await listOps()).toHaveLength(0);
    expect(api.rows.length).toBe(before + 1);
  });

  it('オフラインでは未送信のまま残り、再接続で1回だけ反映される', async () => {
    const api = new DemoApi(); const before = api.rows.length;
    api.offline = true;
    await putOp(op('3')); await putOp(op('4'));
    await syncNow(api); await syncNow(api);
    expect(await listOps()).toHaveLength(2);
    api.offline = false;
    await syncNow(api);
    expect(api.rows.length).toBe(before + 2);
  });

  it('同じキューを同時に2回同期しても増えない', async () => {
    const api = new DemoApi(); const before = api.rows.length;
    await putOp(op('5'));
    await Promise.all([syncNow(api), syncNow(api)]);
    expect(api.rows.length).toBe(before + 1);
  });
});
