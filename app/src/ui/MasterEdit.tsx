import { CircleAlert, LoaderCircle, Trash2 } from 'lucide-react';
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
  const [phase, setPhase] = useState('');
  const busy = !!phase;
  const [confirming, setConfirming] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [newItem, setNewItem] = useState({ himoku: '', budget: '' });
  const [newMethod, setNewMethod] = useState('');

  const load = useCallback(async (keepError = false) => {
    if (!api) return;
    try { setData(await api.settingsRead()); if (!keepError) setError(''); }
    catch (e) { if (!keepError) setError(errorText(e)); }
  }, [api]);
  useEffect(() => { if (open) { setDone(''); load(); } }, [open, load]);

  async function run(ops: SettingsOp[], after?: () => void) {
    if (!api || !ops.length) return;
    setPhase('スプレッドシートに保存しています'); setError(''); setDone(''); setConfirming('');
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
    <Sheet open={open} onOpenChange={o => { if (!o && !busy) { close(); setConfirming(''); onClose(); } }} title={edit ? displayName(edit.himoku) : '費目・予算・支払方法'}>
      <div className="masterstatus">
        <div role="status">
          {phase && <p className="savingbar"><LoaderCircle size={24} strokeWidth={2} className="spin" aria-hidden="true" /><span>{phase}<small>1分ほどかかることがあります</small></span></p>}
          {!phase && done && <p className="syncresult ok">{done}</p>}
        </div>
        {!phase && error && <p className="err" role="alert"><CircleAlert size={16} aria-hidden="true" />{error}</p>}
      </div>
      {!data && !error && <p className="savingbar"><LoaderCircle size={24} strokeWidth={2} className="spin" aria-hidden="true" /><span>取得しています</span></p>}

      {edit && draft ? (
        <div className="masterform">
          <label>月別表示名<input className="input" value={draft.group} onChange={e => setDraft({ ...draft, group: e.target.value })} /></label>
          <p className="hint">月別の画面と月シートの見出しが変わります。入力画面の費目名は変わりません。過去の明細もそのまま集計されます。</p>
          <label>表示順<input className="input num" inputMode="numeric" value={draft.order} onChange={e => setDraft({ ...draft, order: e.target.value })} /></label>
          <label>月額予算<input className="input num" inputMode="numeric" value={draft.budget} onChange={e => setDraft({ ...draft, budget: e.target.value })} /></label>
          {budgetChanged && <p className="hint">{edit.kubun === VAR ? '今月以降の予算が変わります。過去の月は変更前の金額のままです。' : '費目管理の予算が変わります。月ごとの記録はないため、アプリでは今月以降に表示します。'}</p>}
          {edit.kubun === VAR && <label className="check"><input type="checkbox" checked={draft.weekly} onChange={e => setDraft({ ...draft, weekly: e.target.checked })} />週管理の対象にする</label>}
          {edit.kubun === VAR && draft.weekly !== edit.weekly && <p className="hint">過去の週の予算表示も変わります。</p>}
          <label className="check"><input type="checkbox" checked={draft.hidden} onChange={e => setDraft({ ...draft, hidden: e.target.checked })} />入力の候補から隠す（過去の明細と集計は残ります）</label>
          <button type="button" className="primary" disabled={busy || !ops.length || !Number.isFinite(Number(draft.budget)) || !Number.isFinite(Number(draft.order))} onClick={() => run(ops, close)}>{busy && <LoaderCircle size={24} strokeWidth={2} className="spin" aria-hidden="true" />}{busy ? '保存中' : '保存する'}</button>
          <button type="button" className="secondary" style={{ width: '100%', marginTop: 8 }} disabled={busy} onClick={close}>戻る</button>
          <button type="button" className="secondary danger" style={{ width: '100%', marginTop: 8 }} disabled={busy}
            onClick={() => confirming === 'item' ? run([{ type: 'deleteItem', kubun: edit.kubun, row: edit.row, himoku: edit.himoku }], close) : setConfirming('item')}>
            <Trash2 size={24} strokeWidth={2} aria-hidden="true" />{confirming === 'item' ? 'もう一度押すと削除します' : 'この費目を削除する'}</button>
          <p className="hint">明細で使っている費目は削除できません。</p>
        </div>
      ) : data && (
        <>
          <label className="masterform">区分
            <select className="input" value={kubun} onChange={e => setKubun(e.target.value)}>{KUBUN.map(k => <option key={k} value={k}>{KUBUN_LABEL[k]}</option>)}</select>
          </label>
          <div className="list section">
            {list.map(i => (
              <button key={i.row} type="button" className="li pick" onClick={() => { setDone(''); setEdit(i); setDraft(draftOf(i)); }}>
                <span className="grow">{displayName(i.himoku)}{i.hidden && <span className="muted">（非表示）</span>}{i.group && displayName(i.group) !== displayName(i.himoku) && <small className="muted groupname">月別表示名：{displayName(i.group)}</small>}</span>
                {i.weekly && <span className="tag">週</span>}<span className="num muted">{i.budget ? yen(i.budget) : ''}</span>
              </button>
            ))}
          </div>
          <h2 className="h">費目を追加</h2>
          <div className="masterform">
            <input className="input" aria-label="費目名" placeholder="費目名" value={newItem.himoku} onChange={e => setNewItem({ ...newItem, himoku: e.target.value })} />
            <input className="input num" aria-label="月額予算" inputMode="numeric" placeholder="月額予算" value={newItem.budget} onChange={e => setNewItem({ ...newItem, budget: e.target.value })} />
            <button type="button" className="secondary" style={{ width: '100%' }} disabled={busy || !newItem.himoku.trim()} onClick={() => run([{ type: 'add', kubun, himoku: newItem.himoku.trim(), budget: Number(newItem.budget) || 0 }], () => setNewItem({ himoku: '', budget: '' }))}>{busy ? '処理中' : '追加する'}</button>
          </div>
          <h2 className="h">支払方法</h2>
          <div className="list">
            {data.methods.map(m => (
              <label key={m.name} className="li check"><span className="grow">{m.name}</span>
                <span className="muted">隠す</span><input type="checkbox" disabled={busy} checked={m.hidden} onChange={e => run([{ type: 'hide', target: 'method', key: m.name, to: e.target.checked }])} />
                <button type="button" className={confirming === 'm:' + m.name ? 'iconbtn dangerbtn on' : 'iconbtn dangerbtn'} disabled={busy} aria-label={confirming === 'm:' + m.name ? m.name + 'をもう一度押すと削除します' : m.name + 'を削除'}
                  onClick={e => { e.preventDefault(); if (confirming === 'm:' + m.name) run([{ type: 'deleteMethod', name: m.name }]); else setConfirming('m:' + m.name); }}><Trash2 size={24} strokeWidth={2} aria-hidden="true" /></button>
              </label>
            ))}
          </div>
          <div className="masterform section">
            <input className="input" aria-label="支払方法の名前" placeholder="支払方法の名前" value={newMethod} onChange={e => setNewMethod(e.target.value)} />
            <button type="button" className="secondary" style={{ width: '100%' }} disabled={busy || !newMethod.trim()} onClick={() => run([{ type: 'addMethod', name: newMethod.trim() }], () => setNewMethod(''))}>{busy ? '処理中' : '追加する'}</button>
          {confirming.startsWith('m:') && <p className="hint">削除するときは、赤くなったごみ箱をもう一度押してください。明細で使っている支払方法は削除できません。</p>}
          </div>
        </>
      )}
    </Sheet>
  );
}
