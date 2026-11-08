import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Connection, Master, Op, Prefs, SheetRow } from './types';

// 端末保存は IndexedDB。未送信キュー（outbox）は取得結果（cache）とは別の入れ物に置き、
// 取得結果で未送信を上書きしない。
interface KkbDB extends DBSchema {
  outbox: { key: string; value: Op };
  meta: { key: string; value: unknown };
}

export interface Snapshot { rows: SheetRow[]; master: Master; fetchedAt: string; capacity?: { used: number; max: number } }
export interface Draft { [k: string]: unknown }

let dbp: Promise<IDBPDatabase<KkbDB>> | null = null;
export function db(name = 'kakeibo-v3') {
  return (dbp ||= openDB<KkbDB>(name, 1, {
    upgrade(d) {
      d.createObjectStore('outbox', { keyPath: 'opId' });
      d.createObjectStore('meta');
    },
  }));
}
/** テスト用：別のデータベースに切り替える */
export function resetDbForTest(name: string) { dbp = null; return db(name); }

export async function getMeta<T>(key: 'snapshot' | 'prefs' | 'connection' | 'draft' | 'lastSync', fallback: T): Promise<T> {
  return ((await (await db()).get('meta', key)) as T | undefined) ?? fallback;
}
export async function setMeta(key: 'snapshot' | 'prefs' | 'connection' | 'draft' | 'lastSync', value: unknown) {
  await (await db()).put('meta', value, key);
}

export async function listOps(): Promise<Op[]> {
  return (await (await db()).getAll('outbox')).sort((a, b) => a.createdAt - b.createdAt);
}
/** トランザクション完了まで待つ。戻ってきた時点で端末保存は確定している。 */
export async function putOp(op: Op) { await (await db()).put('outbox', op); }
export async function deleteOp(opId: string) { await (await db()).delete('outbox', opId); }

export type { Prefs, Connection };
