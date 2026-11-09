import { BusyVeil } from './Sheet';
import { CircleAlert, FileUp } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, type CsvApplyItem, type CsvItem } from '../lib/api';
import { initialChoice, needsReview, reviewReason, toApply, type CsvChoice } from '../lib/csv';
import { slash } from '../lib/date';
import { displayName, KUBUN_LABEL, yen } from '../lib/display';
import type { AppState } from '../lib/store';

const CHUNK = 30;   // iPhone が待てる時間に収まるよう、少しずつ送る
const ACTIONS: [CsvChoice['action'], string][] = [['add', '登録'], ['recorded', '記録済み'], ['exclude', '対象外']];

const toBase64 = (f: File) => new Promise<string>((ok, no) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(',')[1] ?? '');
  r.onerror = () => no(r.error);
  r.readAsDataURL(f);
});

const errorText = (e: unknown) => {
  const code = e instanceof ApiError ? e.code : 'network';
  return code === 'busy' ? 'スプレッドシートが処理中です。少し待ってからもう一度押してください'
    : code === 'unauthorized' ? '接続が解除されています。設定で接続コードを入力してください'
    : code === 'server' ? `スプレッドシートでエラーが起きました（${(e as Error).message}）`
    : '通信できませんでした。もう一度押してください（反映済みの明細は増えません）';
};

export function Csv({ app }: { app: AppState }) {
  const { api, snap } = app;
  const [items, setItems] = useState<CsvItem[]>([]);
  const [choices, setChoices] = useState<Record<string, CsvChoice>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [summary, setSummary] = useState('');
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    try {
      const list = await api.csvList();
      setItems(list);
      // 自分で選び直した内容は、読み直しても残す
      setChoices(prev => Object.fromEntries(list.map(i => [i.importId, prev[i.importId] ?? initialChoice(i)])));
      setError('');
    } catch (e) { setError(errorText(e)); }
    finally { setLoading(false); }
  }, [api]);
  useEffect(() => { load(); }, [load]);

  async function read(files: { name: string; base64: string }[]) {
    if (!api) return;
    setBusy('読み込み中'); setError(''); setSummary('');
    try {
      const r = await api.csvRead(files);
      setSummary(`候補に追加 ${r.added}件・読込済みで省略 ${r.skipped}件`);
      if (r.errors.length) setError(r.errors.join('／'));
      await load();
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(''); }
  }
  async function pick(list: FileList | null) {
    if (list?.length) read(await Promise.all([...list].map(async f => ({ name: f.name, base64: await toBase64(f) }))));
  }

  const plan = items.map(i => toApply(i, choices[i.importId] ?? initialChoice(i))).filter(Boolean) as CsvApplyItem[];
  const addCount = plan.filter(p => p.action === 'add' || p.action === 'force').length;

  async function apply() {
    if (!api || !plan.length) return;
    setError(''); setSummary('');
    let done = 0; const failed: string[] = [];
    try {
      for (let i = 0; i < plan.length; i += CHUNK) {
        setBusy(`反映中 ${i}/${plan.length}件`);
        for (const r of await api.csvApply(plan.slice(i, i + CHUNK))) {
          if (r.status === 'done') done++;
          else failed.push(`${items.find(x => x.importId === r.importId)?.merchant ?? r.importId}：${r.message || r.error}`);
        }
      }
      setSummary(`${done}件を処理しました`);
      if (failed.length) setError(`反映できなかった明細があります（${failed.length}件）　${failed.slice(0, 3).join('／')}`);
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(''); await load(); await app.sync(); }
  }

  if (!app.api) return <p className="muted section">スプレッドシートに接続すると使えます。</p>;
  if (!app.online) return <p className="muted section">CSVの取り込みはオンライン時にできます。</p>;

  const options = snap.master.items.filter(i => i.kubun.startsWith('支出') && !i.hidden).sort((a, b) => a.order - b.order);
  const review = items.filter(needsReview), plain = items.filter(i => !needsReview(i));
  const setChoice = (id: string, p: Partial<CsvChoice>) => setChoices(c => ({ ...c, [id]: { ...c[id], ...p } }));

  const row = (i: CsvItem) => {
    const c = choices[i.importId] ?? initialChoice(i), why = reviewReason(i);
    return (
      <div key={i.importId} className="csvrow">
        <div className="row"><b className="txname">{i.merchant}</b><b className="num">{yen(i.amount)}</b></div>
        <div className="muted num">{slash(i.date)}・{i.method}</div>
        {why && <p className="err"><CircleAlert size={16} aria-hidden="true" />{why}</p>}
        {c.action === 'add' && (
          <label className="csvselect"><span className="sr">費目</span>
            <select className="input" value={c.key} onChange={e => setChoice(i.importId, { key: e.target.value })}>
              <option value="">費目を選択</option>
              {c.key && !options.some(o => `${o.kubun}|${o.himoku}` === c.key) && <option value={c.key}>{displayName(c.key.split('|').slice(1).join('|'))}</option>}
              {['支出（変動費）', '支出（固定費）', '支出（特別費）'].map(k => (
                <optgroup key={k} label={KUBUN_LABEL[k]}>
                  {options.filter(o => o.kubun === k).map(o => <option key={o.himoku} value={`${k}|${o.himoku}`}>{displayName(o.himoku)}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
        )}
        {c.action === 'add' && i.reason && c.key && <p className="hint">{i.reason}</p>}
        <div className="filters" role="group" aria-label={`${i.merchant}の処理`}>
          {ACTIONS.map(([a, label]) => <button key={a} type="button" aria-pressed={c.action === a} onClick={() => setChoice(i.importId, { action: c.action === a ? '' : a })}>{label}</button>)}
        </div>
      </div>
    );
  };

  return (
    <div>
      <input ref={input} type="file" accept=".csv,text/csv" multiple hidden onChange={e => { pick(e.target.files); e.target.value = ''; }} />
      <button type="button" className="primary" style={{ marginTop: 8 }} disabled={!!busy}
        onClick={() => app.conn.mode === 'demo' ? read([]) : input.current?.click()}>
        <FileUp size={20} strokeWidth={2} aria-hidden="true" /> {app.conn.mode === 'demo' ? 'サンプルの明細を読み込む' : 'CSVファイルを選ぶ'}
      </button>
      <div role="status">
        {busy && <BusyVeil text={busy} sub="画面を閉じずにお待ちください" />}
        {summary && !busy && <p className="syncresult ok">{summary}</p>}
      </div>
      {error && <p className="err" role="alert"><CircleAlert size={16} aria-hidden="true" />{error}</p>}
      {loading && !items.length && <p className="muted">取得中</p>}
      {!loading && !items.length && !error && <p className="muted section">確認待ちの明細はありません</p>}

      {review.length > 0 && <section className="section"><h2 className="h" style={{ marginTop: 0 }}>確認が必要 {review.length}件</h2><div className="list">{review.map(row)}</div></section>}
      {plain.length > 0 && <section className="section"><h2 className="h" style={{ marginTop: 0 }}>未記録 {plain.length}件</h2><div className="list">{plain.map(row)}</div></section>}

      {items.length > 0 && (
        <button type="button" className="primary" disabled={!plan.length || !!busy} onClick={apply}>
          {busy ? busy : `反映する（登録 ${addCount}件・そのほか ${plan.length - addCount}件）`}
        </button>
      )}
    </div>
  );
}
