import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, SheetApi, type Api } from './api';
import { deleteOp, getMeta, listOps, putOp, setMeta, type Snapshot } from './db';
import { demoApi, demoMaster } from './demo';
import { syncNow, type SyncResult } from './sync';
import { DEFAULT_PREFS, type Connection, type NewTx, type Op, type Prefs, type SheetRow } from './types';

const EMPTY: Snapshot = { rows: [], master: { items: [], methods: [] }, fetchedAt: '' };

export type Notice = { text: string; kind: 'info' | 'error'; retry?: boolean };

export function syncMessage(r: SyncResult, unsent: number): Notice | null {
  if (r.error === 'skipped') return null;
  if (r.error === 'unauthorized') return { text: '接続が解除されています。設定で接続コードを入力してください', kind: 'error' };
  if (r.error) return { text: `同期できませんでした・未送信 ${unsent}件`, kind: 'error', retry: true };
  if (r.failed) return { text: `スプレッドシートが受け付けなかった取引があります（${r.failed}件）。設定の「未送信」で理由を確認できます`, kind: 'error' };
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
  const sync = useCallback(async (manual = false): Promise<Notice | null> => {
    if (!api) return { text: 'スプレッドシートに未接続です', kind: 'error' };
    if (busy.current) return null;
    busy.current = true; setSyncing(true);
    try {
      const r = await syncNow(api);
      await reload();
      const msg = syncMessage(r, (await listOps()).length);
      // 自動同期の失敗は上部の状態表示（未送信件数）で知らせ、毎回の通知は出さない
      if (msg && (r.sent || r.failed)) setNotice(msg);
      return msg ?? (manual && r.pulled ? { text: '同期しました', kind: 'info' } : null);
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

  /** 送信済み取引の修正（tx あり）・削除（tx なし）。端末に保存してすぐ戻り、送信は後ろで行う。戻り値は画面に出すエラー文、成功なら空文字。 */
  const applyEdit = useCallback(async (opId: string, row: SheetRow, tx: NewTx | null): Promise<string> => {
    const prev = (await listOps()).find(o => o.type !== 'add' && o.target?.id === row.id);
    if (prev?.state === 'unknown') return '前の修正を送信確認中です。同期が終わってから、もう一度修正してください';
    if (prev) await deleteOp(prev.opId);
    const shown: NewTx = { id: row.id, date: row.date, amount: row.amount, kubun: row.kubun as NewTx['kubun'], himoku: row.himoku, method: row.method, place: row.g, detail: '', sat: row.sat };
    // まだ送っていない修正を直したときは、元の取得内容（ハッシュ）を対象のまま使う
    const target = prev?.state === 'pending' && prev.target ? prev.target : { id: row.id, hash: row.hash, row: row.row };
    await putOp({ opId, type: tx ? 'update' : 'delete', tx: tx ?? shown, target, state: 'pending', createdAt: Date.now() });
    setOps(await listOps());
    setNotice({ text: tx ? '修正を端末に保存しました。スプレッドシートへ送っています' : '削除を端末に保存しました。スプレッドシートへ送っています', kind: 'info' });
    sync();
    return '';
  }, [sync]);

  // 未送信の修正・削除を、取得した明細に重ねて見せる（送信が終わるまで画面の数字が古いままにならないように）
  const view = useMemo(() => {
    const edits = ops.filter(o => o.type !== 'add');
    if (!edits.length) return snap;
    const rows = snap.rows.flatMap(r => {
      const e = edits.filter(o => o.target?.id === r.id).pop();
      if (!e) return [r];
      if (e.type === 'delete') return e.state === 'failed' ? [{ ...r, pending: e.state }] : [];
      const t = e.tx;
      return [{ ...r, date: t.date, amount: t.amount, kubun: t.kubun, himoku: t.himoku, method: t.method,
        g: [t.place, t.detail].filter(Boolean).join('／'), sat: t.sat || 'ー', pending: e.state }];
    });
    return { ...snap, rows };
  }, [snap, ops]);

  const removeOp = useCallback(async (opId: string) => { await deleteOp(opId); setOps(await listOps()); }, []);

  /** 受け付けられなかった操作を、同じ内容のまま送り直す（同じ操作IDなので二重にはならない） */
  const retryOp = useCallback(async (opId: string) => {
    const op = (await listOps()).find(o => o.opId === opId);
    if (!op) return;
    await putOp({ ...op, state: 'pending', error: undefined });
    setOps(await listOps());
    sync();
  }, [sync]);

  const savePrefs = useCallback(async (p: Prefs) => { setPrefs(p); await setMeta('prefs', p); }, []);

  const saveConn = useCallback(async (c: Connection) => {
    setConn(c); await setMeta('connection', c);
    if (c.mode !== conn.mode || c.url !== conn.url) { await setMeta('snapshot', EMPTY); await setMeta('lastSync', ''); }
  }, [conn]);

  const pair = useCallback(async (url: string, code: string) => {
    // 別のスプレッドシートへつなぎ直すとき、前の接続先宛ての未送信があれば止める（新しい接続先に送られてしまうため）
    if (conn.mode === 'sheet' && conn.url && conn.url !== url && ops.length > 0)
      return `前の接続先への未送信が ${ops.length}件あります。先に「今すぐ同期」で送るか、未送信の一覧から削除してから接続してください`;
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
  }, [saveConn, conn, ops]);

  return { ready, conn, prefs, snap: view, ops, lastSync, syncing, notice, setNotice, online, api,
    sync, saveOp, applyEdit, removeOp, retryOp, savePrefs, saveConn, pair };
}
export type AppState = ReturnType<typeof useApp>;
