import { CircleAlert, LoaderCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, type SettingsData, type SettingsItem, type SettingsOp } from '../lib/api';
import { displayName, KUBUN_LABEL, yen } from '../lib/display';
import type { AppState } from '../lib/store';
import { KUBUN } from '../lib/types';
import { BusyVeil, Sheet } from './Sheet';

const VAR = '支出（変動費）';
type Draft = { order: string; budget: string; weekly: boolean; hidden: boolean };
const draftOf = (i: SettingsItem): Draft => ({ order: String(i.order), budget: String(i.budget), weekly: i.weekly, hidden: i.hidden });

/** 変更のあった項目だけを送る。変更前の値を付け、スプレッドシート側の変更を上書きしない。 */
export function diffOps(i: SettingsItem, d: Draft): SettingsOp[] {
  const base = { kubun: i.kubun, row: i.row, himoku: i.himoku };
  const ops: SettingsOp[] = [];
  if (Number(d.order) !== i.order) ops.push({ ...base, type: 'order', from: i.order, to: Number(d.order) });
  if (Number(d.budget) !== i.budget) ops.push({ ...base, type: 'budget', from: i.budget, to: Number(d.budget) });
  if (d.weekly !== i.weekly) ops.push({ ...base, type: 'weekly', from: i.weekly, to: d.weekly });
  if (d.hidden !== i.hidden) ops.push({ type: 'hide', target: 'item', key: `${i.kubun}|${i.himoku}`, to: d.hidden });
  return ops;
}

const errorText = (e: unknown) => e instanceof ApiError && e.code === 'busy'
  ? 'スプレッドシートが処理中です。少し待ってからもう一度押してください'
  : e instanceof ApiError && e.code === 'server' ? `スプレッドシートでエラーが起きました（${e.message}）` : '通信できませんでした。もう一度押してください';

export function MasterEdit({ app, open, onClose }: { app: AppState; open: boolean; onClose: () => void }) {
  const { api } = app;
  const [data, setData] = useState<SettingsData | null>(null);
  const [kubun, setKubun] = useState<string>(VAR);
  const [edit, setEdit] = useState<SettingsItem | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [phase, setPhase] = useState('');
  const busy = !!phase;
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const load = useCallback(async (keepError = false) => {
    if (!api) return;
    try { setData(await api.settingsRead()); if (!keepError) setError(''); }
    catch (e) { if (!keepError) setError(errorText(e)); }
  }, [api]);
  useEffect(() => { if (open) { setDone(''); load(); } }, [open, load]);

  async function run(ops: SettingsOp[], after?: () => void) {
    if (!api || !ops.length) return;
    setPhase('スプレッドシートに保存しています'); setError(''); setDone('');
    try {
      for (const op of ops) {
        const r = await api.settingsApply(op);
        if (r.status === 'conflict') { setError(r.message || 'スプレッドシート側で変更されています。読み直したので、確認してもう一度保存してください'); setPhase('読み直しています'); await load(true); return; }
        if (r.status === 'error') { setError(r.message || '保存できませんでした'); setPhase('読み直しています'); await load(true); return; }
      }
      after?.();
      setPhase('アプリに反映しています');
      await load();
      await app.sync();
      setDone('スプレッドシートに保存しました');
    } catch (e) {
      // 応答が届かなくても保存できている場合があるので、今の内容を読み直して見せる
      setError(e instanceof ApiError && e.code === 'network' ? '応答がありませんでした。今の内容を読み直したので、反映されているか確認してください' : errorText(e));
      setPhase('読み直しています');
      await load(true);
    } finally { setPhase(''); }
  }

  const list = (data?.items ?? []).filter(i => i.kubun === kubun).sort((a, b) => a.order - b.order);
  const ops = edit && draft ? diffOps(edit, draft) : [];
  const budgetChanged = ops.some(o => o.type === 'budget');
  const close = () => { setEdit(null); setDraft(null); };

  return (
    <Sheet open={open} onOpenChange={o => { if (!o && !busy) { close(); onClose(); } }} title={edit ? displayName(edit.himoku) : '費目・予算・支払方法'}>
      {phase && <BusyVeil text={phase} sub="1分ほどかかることがあります" />}
      <div className="masterstatus">
        <div role="status">
          {!phase && done && <p className="syncresult ok">{done}</p>}
        </div>
        {!phase && error && <p className="err" role="alert"><CircleAlert size={16} aria-hidden="true" />{error}</p>}
      </div>
      {!data && !error && <BusyVeil text="取得しています" />}

      {edit && draft ? (
        <div className="masterform">
          <label>表示順<input className="input num" inputMode="numeric" value={draft.order} onChange={e => setDraft({ ...draft, order: e.target.value })} /></label>
          <label>月額予算<input className="input num" inputMode="numeric" value={draft.budget} onChange={e => setDraft({ ...draft, budget: e.target.value })} /></label>
          {budgetChanged && <p className="hint">{edit.kubun === VAR ? '今月以降の予算が変わります。過去の月は変更前の金額のままです。' : '費目管理の予算が変わります。月ごとの記録はないため、アプリでは今月以降に表示します。'}</p>}
          {edit.kubun === VAR && <label className="check"><input type="checkbox" checked={draft.weekly} onChange={e => setDraft({ ...draft, weekly: e.target.checked })} />週管理の対象にする</label>}
          {edit.kubun === VAR && draft.weekly !== edit.weekly && <p className="hint">過去の週の予算表示も変わります。</p>}
          <label className="check"><input type="checkbox" checked={draft.hidden} onChange={e => setDraft({ ...draft, hidden: e.target.checked })} />入力の候補から隠す（過去の明細と集計は残ります）</label>
          <button type="button" className="primary" disabled={busy || !ops.length || !Number.isFinite(Number(draft.budget)) || !Number.isFinite(Number(draft.order))} onClick={() => run(ops, close)}>{busy && <LoaderCircle size={20} strokeWidth={2} className="spin" aria-hidden="true" />}{busy ? '保存中' : '保存する'}</button>
          <button type="button" className="secondary" style={{ width: '100%', marginTop: 8 }} disabled={busy} onClick={close}>戻る</button>
        </div>
      ) : data && (
        <>
          <label className="masterform">区分
            <select className="input" value={kubun} onChange={e => setKubun(e.target.value)}>{KUBUN.map(k => <option key={k} value={k}>{KUBUN_LABEL[k]}</option>)}</select>
          </label>
          <div className="list section">
            {list.map(i => (
              <button key={i.row} type="button" className="li pick" onClick={() => { setDone(''); setEdit(i); setDraft(draftOf(i)); }}>
                <span className="grow">{displayName(i.himoku)}{i.hidden && <span className="muted">（非表示）</span>}</span>
                {i.weekly && <span className="tag">週</span>}<span className="num muted">{i.budget ? yen(i.budget) : ''}</span>
              </button>
            ))}
          </div>
          <p className="hint">費目の追加・削除は、スプレッドシートの費目管理で行います。</p>
          <h2 className="h">支払方法</h2>
          <div className="list">
            {data.methods.map(m => (
              <label key={m.name} className="li check"><span className="grow">{m.name}</span>
                <span className="muted">隠す</span><input type="checkbox" disabled={busy} checked={m.hidden} onChange={e => run([{ type: 'hide', target: 'method', key: m.name, to: e.target.checked }])} />
              </label>
            ))}
          </div>
          <p className="hint">支払方法の追加・削除は、スプレッドシートの費目管理で行います。</p>
        </>
      )}
    </Sheet>
  );
}
