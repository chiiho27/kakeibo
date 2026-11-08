import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, SheetApi, type Api } from './api';
import { deleteOp, getMeta, listOps, putOp, setMeta, type Snapshot } from './db';
import { demoApi, demoMaster } from './demo';
import { syncNow, type SyncResult } from './sync';
import { DEFAULT_PREFS, type Connection, type Op, type Prefs } from './types';

const EMPTY: Snapshot = { rows: [], master: { items: [], methods: [] }, fetchedAt: '' };

export type Notice = { text: string; kind: 'info' | 'error'; retry?: boolean };

export function syncMessage(r: SyncResult, unsent: number): Notice | null {
  if (r.error === 'skipped') return null;
  if (r.error === 'unauthorized') return { text: '接続が解除されています。設定で接続コードを入力してください', kind: 'error' };
  if (r.error) return { text: `同期できませんでした・未送信 ${unsent}件`, kind: 'error', retry: true };
  if (r.failed) return { text: `スプレッドシートが受け付けなかった取引があります（${r.failed}件）`, kind: 'error' };
  if (r.sent) return { text: 'スプレッドシートに保存しました', kind: 'info' };
  return null;
}

export function useApp() {
  const [ready, setReady] = useState(false);
  const [conn, setConn] = useState<Connection>({ mode: 'demo', url: '', device: '' });
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [snap, setSnap] = useState<Snapshot>(EMPTY);
  const [ops, setOps] = useState<Op[]>([]);
  const [lastSync, setLastSync] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [online, setOnline] = useState(navigator.onLine);

  const api: Api | null = useMemo(() => conn.mode === 'demo' ? demoApi
    : conn.url && conn.device ? new SheetApi(conn.url, conn.device) : null, [conn]);

  const reload = useCallback(async () => {
    const s = await getMeta<Snapshot>('snapshot', EMPTY);
    setSnap(s.master.items.length || conn.mode !== 'demo' ? s : { ...s, master: demoMaster() });
    setOps(await listOps());
    setLastSync(await getMeta('lastSync', ''));
  }, [conn.mode]);

  const busy = useRef(false);
  const sync = useCallback(async (manual = false) => {
    if (!api || busy.current) return;
    busy.current = true; setSyncing(true);
    try {
      const r = await syncNow(api);
      await reload();
      const msg = syncMessage(r, (await listOps()).length);
      // 自動同期の失敗は上部の状態表示（未送信件数）で知らせ、毎回の通知は出さない
      if (msg && (manual || r.sent || r.failed)) setNotice(msg);
    } finally {
      busy.current = false; setSyncing(false);
    }
  }, [api, reload]);

  useEffect(() => {
    (async () => {
      setConn(await getMeta('connection', { mode: 'demo', url: '', device: '' } as Connection));
      setPrefs({ ...DEFAULT_PREFS, ...(await getMeta<Partial<Prefs>>('prefs', {})) });
      navigator.storage?.persist?.().catch(() => {});
      setReady(true);
    })();
  }, []);

  // 起動時・再表示時・再接続時に送信と再取得。アプリを閉じている間の同期は行わない。
  useEffect(() => {
    if (!ready) return;
    reload().then(() => sync());
    const vis = () => { if (document.visibilityState === 'visible') sync(); };
    const on = () => { setOnline(true); sync(); };
    const off = () => setOnline(false);
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { document.removeEventListener('visibilitychange', vis); window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, [ready, reload, sync]);

  /** 端末保存（完了を待つ）→ 送信。同じ操作IDなら何度呼ばれても1件。 */
  const saveOp = useCallback(async (op: Op) => {
    await putOp(op);
    const list = await listOps();
    setOps(list);
    setNotice({ text: `端末に保存しました・未送信 ${list.length}件`, kind: 'info' });
    sync();
  }, [sync]);

  const removeOp = useCallback(async (opId: string) => { await deleteOp(opId); setOps(await listOps()); }, []);

  const savePrefs = useCallback(async (p: Prefs) => { setPrefs(p); await setMeta('prefs', p); }, []);

  const saveConn = useCallback(async (c: Connection) => {
    setConn(c); await setMeta('connection', c);
    if (c.mode !== conn.mode || c.url !== conn.url) { await setMeta('snapshot', EMPTY); await setMeta('lastSync', ''); }
  }, [conn]);

  const pair = useCallback(async (url: string, code: string) => {
    try {
      const device = await new SheetApi(url, '').pair(code, navigator.userAgent.includes('iPhone') ? 'iPhone' : 'PC');
      await saveConn({ mode: 'sheet', url, device });
      setNotice({ text: 'スプレッドシートに接続しました', kind: 'info' });
      return '';
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'network';
      return code === 'pair_wrong' ? '接続コードが違います' : code === 'pair_expired' ? '接続コードの期限が切れています。スプレッドシートで発行し直してください'
        : code === 'network' ? '接続できませんでした。URLと通信状態を確認してください' : '接続できませんでした';
    }
  }, [saveConn]);

  return { ready, conn, prefs, snap, ops, lastSync, syncing, notice, setNotice, online, api,
    sync, saveOp, removeOp, savePrefs, saveConn, pair };
}
export type AppState = ReturnType<typeof useApp>;
