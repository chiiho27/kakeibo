import { ApiError, type Api } from './api';
import { deleteOp, getMeta, listOps, putOp, setMeta, type Snapshot } from './db';
import type { PushResult } from './api';
import type { Op } from './types';

export interface SyncResult {
  sent: number;            // スプレッドシートへの保存を確認できた件数
  failed: number;          // スプレッドシートが受け付けなかった件数
  pulled: boolean;
  error?: ApiError['code'] | 'skipped';
  detail?: string;
}

/**
 * 1. 未送信を同じ操作IDで送る（サーバーは処理済みの操作IDに前回と同じ結果を返す）
 * 2. スプレッドシートを読み直し、取得結果に現れた取引は未送信から外す
 * 複数タブ・多重実行は Web Locks で1つに絞る。
 */
export async function syncNow(api: Api, opts: { skipPullIfMerged?: boolean } = {}): Promise<SyncResult> {
  const run = async (): Promise<SyncResult> => {
    const result: SyncResult = { sent: 0, failed: 0, pulled: false };
    const ops = (await listOps()).filter(o => o.state !== 'failed');
    if (ops.length) {
      try {
        const results = await api.push(ops);
        const done: [Op, PushResult][] = [];
        for (const op of ops) {
          const r = results.find(x => x.opId === op.opId);
          if (r?.status === 'done') { done.push([op, r]); result.sent++; }
          else if (r) { await putOp({ ...op, state: 'failed', error: r.message || r.error || 'error' }); result.failed++; }
        }
        // 書き込んだ行が全部返ってきたら手元の明細に反映し、重い読み直しを省く（登録直後だけ）
        const merged = opts.skipPullIfMerged && done.length === ops.length && await mergeResults(done);
        for (const [op] of done) await deleteOp(op.opId);
        if (merged) return result;
      } catch (e) {
        const err = e instanceof ApiError ? e : new ApiError('network');
        // 応答が届かなかった場合だけ「入ったかもしれない」。次回同じ操作IDで再送して確かめる。
        if (err.code === 'network') for (const op of ops) await putOp({ ...op, state: 'unknown' });
        result.error = err.code;
        result.detail = err.message !== err.code ? err.message : undefined;
        if (err.code !== 'busy') return result;
      }
    }
    try {
      const res = await api.pull();
      const snapshot: Snapshot = { rows: res.rows, master: res.master, special: res.special, frozen: res.frozen, fetchedAt: res.serverTime, capacity: res.capacity };
      await setMeta('snapshot', snapshot);
      await setMeta('lastSync', res.serverTime);
      const ids = new Set(res.rows.map(r => r.id));
      for (const op of await listOps()) if (op.type === 'add' && ids.has(op.tx.id)) { await deleteOp(op.opId); if (op.state !== 'pending') result.sent++; }
      result.pulled = true;
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError('network');
      result.error ||= err.code;
      result.detail ||= err.message !== err.code ? err.message : undefined;
    }
    return result;
  };
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request('kakeibo-sync', { ifAvailable: true }, lock =>
      lock ? run() : Promise.resolve<SyncResult>({ sent: 0, failed: 0, pulled: false, error: 'skipped' }));
  }
  return run();
}

/** 送信結果の行を、保存してある明細に重ねる。1件でも行が返っていなければ何もせず false（読み直しに回す） */
export async function mergeResults(done: [Op, PushResult][]): Promise<boolean> {
  if (!done.every(([op, r]) => op.type === 'delete' ? r.deleted : r.sheetRow)) return false;
  const snap = await getMeta<Snapshot | null>('snapshot', null);
  if (!snap || !snap.master.items.length) return false;
  let rows = snap.rows;
  for (const [op, r] of done) {
    const id = op.type === 'add' ? op.tx.id : op.target?.id;
    rows = rows.filter(x => x.id !== id);
    if (r.sheetRow) rows = [...rows, r.sheetRow];
  }
  rows.sort((a, b) => (a.row ?? 0) - (b.row ?? 0));
  await setMeta('snapshot', { ...snap, rows, capacity: snap.capacity && { ...snap.capacity, used: rows.length } });
  return true;
}
