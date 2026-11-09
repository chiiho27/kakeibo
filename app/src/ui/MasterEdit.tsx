import { CircleAlert } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, type SettingsData, type SettingsItem, type SettingsOp } from '../lib/api';
import { displayName, KUBUN_LABEL, yen } from '../lib/display';
import type { AppState } from '../lib/store';
import { KUBUN } from '../lib/types';
import { Sheet } from './Sheet';

const VAR = '支出（変動費）';
type Draft = { group: string; order: string; budget: string; weekly: boolean; hidden: boolean };
const draftOf = (i: SettingsItem): Draft => ({ group: i.group, order: String(i.order), budget: String(i.budget), weekly: i.weekly, hidden: i.hidden });

/** 変更のあった項目だけを送る。変更前の値を付け、スプレッドシート側の変更を上書きしない。 */
export function diffOps(i: SettingsItem, d: Draft): SettingsOp[] {
  const base = { kubun: i.kubun, row: i.row, himoku: i.himoku };
  const ops: SettingsOp[] = [];
  if (d.group.trim() && d.group.trim() !== i.group) ops.push({ ...base, type: 'group', from: i.group, to: d.group.trim() });
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [newItem, setNewItem] = useState({ himoku: '', budget: '' });
  const [newMethod, setNewMethod] = useState('');

  const load = useCallback(async () => {
    if (!api) return;
    try { setData(await api.settingsRead()); setError(''); }
    catch (e) { setError(errorText(e)); }
  }, [api]);
  useEffect(() => { if (open) { setDone(''); load(); } }, [open, load]);

  async function run(ops: SettingsOp[], after?: () => void) {
    if (!api || !ops.length) return;
    setBusy(true); setError(''); setDone('');
    try {
      for (const op of ops) {
        const r = await api.settingsApply(op);
        if (r.status === 'conflict') { setError(r.message || 'スプレッドシート側で変更されています。読み直したので、確認してもう一度保存してください'); await load(); return; }
        if (r.status === 'error') { setError(r.message || '保存できませんでした'); await load(); return; }
      }
      setDone('スプレッドシートに保存しました');
      after?.();
      await load();
      await app.sync();
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }

  const list = (data?.items ?? []).filter(i => i.kubun === kubun).sort((a, b) => a.order - b.order);
  const ops = edit && draft ? diffOps(edit, draft) : [];
  const budgetChanged = ops.some(o => o.type === 'budget');
  const close = () => { setEdit(null); setDraft(null); };

  return (
    <Sheet open={open} onOpenChange={o => { if (!o) { close(); onClose(); } }} title={edit ? displayName(edit.himoku) : '費目・予算・支払方法'}>
      <div role="status">{done && <p className="syncresult ok">{done}</p>}</div>
      {error && <p className="err" role="alert"><CircleAlert size={16} aria-hidden="true" />{error}</p>}
      {!data && !error && <p className="muted">取得中</p>}

      {edit && draft ? (
        <div className="masterform">
          <label>月別表示名<input className="input" value={draft.group} onChange={e => setDraft({ ...draft, group: e.target.value })} /></label>
          <p className="hint">費目名は変わりません。過去の明細もそのまま集計されます。</p>
          <label>表示順<input className="input num" inputMode="numeric" value={draft.order} onChange={e => setDraft({ ...draft, order: e.target.value })} /></label>
          <label>月額予算<input className="input num" inputMode="numeric" value={draft.budget} onChange={e => setDraft({ ...draft, budget: e.target.value })} /></label>
          {budgetChanged && <p className="hint">{edit.kubun === VAR ? '今月以降の予算が変わります。過去の月は変更前の金額のままです。' : '費目管理の予算が変わります。月ごとの記録はないため、アプリでは今月以降に表示します。'}</p>}
          {edit.kubun === VAR && <label className="check"><input type="checkbox" checked={draft.weekly} onChange={e => setDraft({ ...draft, weekly: e.target.checked })} />週管理の対象にする</label>}
          {edit.kubun === VAR && draft.weekly !== edit.weekly && <p className="hint">過去の週の予算表示も変わります。</p>}
          <label className="check"><input type="checkbox" checked={draft.hidden} onChange={e => setDraft({ ...draft, hidden: e.target.checked })} />入力の候補から隠す（過去の明細と集計は残ります）</label>
          <button type="button" className="primary" disabled={busy || !ops.length || !Number.isFinite(Number(draft.budget)) || !Number.isFinite(Number(draft.order))} onClick={() => run(ops, close)}>{busy ? '保存中' : '保存する'}</button>
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
          <h2 className="h">費目を追加</h2>
          <div className="masterform">
            <input className="input" aria-label="費目名" placeholder="費目名" value={newItem.himoku} onChange={e => setNewItem({ ...newItem, himoku: e.target.value })} />
            <input className="input num" aria-label="月額予算" inputMode="numeric" placeholder="月額予算" value={newItem.budget} onChange={e => setNewItem({ ...newItem, budget: e.target.value })} />
            <button type="button" className="secondary" style={{ width: '100%' }} disabled={busy || !newItem.himoku.trim()} onClick={() => run([{ type: 'add', kubun, himoku: newItem.himoku.trim(), budget: Number(newItem.budget) || 0 }], () => setNewItem({ himoku: '', budget: '' }))}>追加する</button>
          </div>
          <h2 className="h">支払方法</h2>
          <div className="list">
            {data.methods.map(m => (
              <label key={m.name} className="li check"><span className="grow">{m.name}</span>
                <span className="muted">隠す</span><input type="checkbox" disabled={busy} checked={m.hidden} onChange={e => run([{ type: 'hide', target: 'method', key: m.name, to: e.target.checked }])} />
              </label>
            ))}
          </div>
          <div className="masterform section">
            <input className="input" aria-label="支払方法の名前" placeholder="支払方法の名前" value={newMethod} onChange={e => setNewMethod(e.target.value)} />
            <button type="button" className="secondary" style={{ width: '100%' }} disabled={busy || !newMethod.trim()} onClick={() => run([{ type: 'addMethod', name: newMethod.trim() }], () => setNewMethod(''))}>追加する</button>
          </div>
        </>
      )}
    </Sheet>
  );
}
