import { beforeEach, describe, expect, it } from 'vitest';
import { DemoApi, demoMaster } from './demo';
import { getMeta, listOps, putOp, resetDbForTest, setMeta, type Snapshot } from './db';
import { syncNow } from './sync';
import type { Op, SheetRow } from './types';

const tx = { id: 'tx-a', date: '2026-11-18', amount: 580, kubun: '支出（変動費）' as const, himoku: '食費', method: '現金', place: 'コンビニ', detail: '', sat: '' };
const old: SheetRow = { id: 'tx-old', date: '2026-11-01', amount: 100, kubun: '支出（変動費）', himoku: '食費', method: '現金', g: '', sat: 'ー', source: '手入力', row: 4, hash: 'h0' };

// スプレッドシートが書き込んだ行を返す版（新しいスクリプト）
class RowApi extends DemoApi {
  pulls = 0;
  async pull() { this.pulls++; return super.pull(); }
  async push(ops: Op[]) {
    return ops.map(o => o.type === 'delete'
      ? { opId: o.opId, status: 'done' as const, deleted: true }
      : { opId: o.opId, status: 'done' as const, sheetRow: { id: o.type === 'add' ? o.tx.id : o.target!.id, date: o.tx.date, amount: o.tx.amount, kubun: o.tx.kubun, himoku: o.tx.himoku, method: o.tx.method, g: o.tx.place, sat: 'ー', source: '手入力', row: 9, hash: 'h1' } });
  }
}

describe('登録直後の同期', () => {
  let n = 0;
  beforeEach(async () => {
    await resetDbForTest('s' + n++);
    await setMeta('snapshot', { rows: [old], master: demoMaster(), fetchedAt: '' } satisfies Snapshot);
  });

  it('書き込んだ行が返れば、読み直さずに手元の明細へ足す', async () => {
    const api = new RowApi();
    await putOp({ opId: 'o1', type: 'add', tx, state: 'pending', createdAt: 0 });
    const r = await syncNow(api, { skipPullIfMerged: true });
    expect(r.sent).toBe(1);
    expect(api.pulls).toBe(0);
    expect(await listOps()).toHaveLength(0);
    const s = await getMeta<Snapshot>('snapshot', null as never);
    expect(s.rows.map(x => x.id)).toEqual(['tx-old', 'tx-a']);
    expect(s.rows[1].hash).toBe('h1');
  });

  it('修正は行を置き換え、削除は行を消す', async () => {
    const api = new RowApi();
    await putOp({ opId: 'u', type: 'update', tx: { ...tx, id: 'tx-old', amount: 999 }, target: { id: 'tx-old', hash: 'h0', row: 4 }, state: 'pending', createdAt: 0 });
    await syncNow(api, { skipPullIfMerged: true });
    let s = await getMeta<Snapshot>('snapshot', null as never);
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0].amount).toBe(999);
    await putOp({ opId: 'd', type: 'delete', tx, target: { id: 'tx-old', hash: 'h1', row: 9 }, state: 'pending', createdAt: 0 });
    await syncNow(api, { skipPullIfMerged: true });
    s = await getMeta<Snapshot>('snapshot', null as never);
    expect(s.rows).toHaveLength(0);
    expect(api.pulls).toBe(0);
  });

  it('行が返らない（古いスクリプト）ときや、開いたときの同期は読み直す', async () => {
    const api = new DemoApi();
    await putOp({ opId: 'o2', type: 'add', tx, state: 'pending', createdAt: 0 });
    const r = await syncNow(api, { skipPullIfMerged: true });
    expect(r.pulled).toBe(true);
    const api2 = new RowApi();
    await putOp({ opId: 'o3', type: 'add', tx: { ...tx, id: 'tx-b' }, state: 'pending', createdAt: 0 });
    expect((await syncNow(api2)).pulled).toBe(true);
    expect(api2.pulls).toBe(1);
  });
});
