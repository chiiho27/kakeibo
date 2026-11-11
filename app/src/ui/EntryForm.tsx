import * as Dialog from '@radix-ui/react-dialog';
import { CalendarDays, ChevronDown, ClipboardPaste, ChevronLeft, ChevronRight, CircleAlert, CreditCard, Delete, LayoutGrid, X } from 'lucide-react';
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { evaluate, formatExpr, hasOperator, press } from '../lib/calc';
import { daysInMonth, isValidYmd, parts, slash, today, weekdayMon, ymd } from '../lib/date';
import { getMeta, setMeta } from '../lib/db';
import { displayName, iconFor, KUBUN_LABEL, yen } from '../lib/display';
import type { AppState } from '../lib/store';
import { K_INC, K_SAVE, K_VAR, SATISFACTION, type Kubun, type Op, type SheetRow } from '../lib/types';
import { PickList, Sheet } from './Sheet';

interface Draft {
  opId: string; txId: string; date: string; expr: string; kubun: Kubun; himoku: string; himokuPicked: boolean;
  method: string; place: string; sat: string;
}

const EXPENSE: Kubun[] = ['支出（変動費）', '支出（固定費）', '支出（特別費）'];
// 区分は1行にまとめる（以前は「支出／収入／貯蓄」と「変動費／固定費／特別費」の2段）
const KUBUN_ROW: [string, Kubun][] = [['変動費', K_VAR], ['固定費', '支出（固定費）'], ['特別費', '支出（特別費）'], ['収入', K_INC], ['貯蓄', K_SAVE]];
const TOP_HIMOKU = 7;
// G列は1つの「詳細」として扱う。カード明細の店名には「／ｉＤ」のように／を含むものがあるので分割しない。
const placeOf = (g: string) => g.trim();
const normPlace = (s: string) => s.normalize('NFKC').trim().toLowerCase();
// 数字を大きく押しやすく。右端は ⌫ − + =（÷ × は使う場面が少ないので外した。キーボードからは入力できる）
const KEYS = ['7', '8', '9', 'back', '4', '5', '6', '−', '1', '2', '3', '+', 'clear', '0', '00', '='];
const KEY_LABEL: Record<string, string> = { clear: '全部消す', back: '1文字消す' };

function CalendarPicker({ value, onPick }: { value: string; onPick: (d: string) => void }) {
  const [v, setV] = useState<[number, number]>(() => { const [y, m] = parts(value); return [y, m]; });
  const [y, m] = v;
  const move = (d: number) => setV(([yy, mm]) => { const t = new Date(yy, mm - 1 + d, 1); return [t.getFullYear(), t.getMonth() + 1]; });
  const days = Array.from({ length: daysInMonth(y, m) }, (_, i) => ymd(y, m, i + 1));
  const now = today();
  return (
    <div>
      <div className="row" style={{ alignItems: 'center' }}>
        <button type="button" className="iconbtn" aria-label="前の月" onClick={() => move(-1)}><ChevronLeft size={20} strokeWidth={2} /></button>
        <b className="num">{y}/{String(m).padStart(2, '0')}</b>
        <button type="button" className="iconbtn" aria-label="次の月" onClick={() => move(1)}><ChevronRight size={20} strokeWidth={2} /></button>
      </div>
      <div className="calgrid" style={{ marginTop: 8 }}>
        {'月火水木金土日'.split('').map(w => <span key={w} className="muted wd">{w}</span>)}
        {Array.from({ length: weekdayMon(days[0]) }, (_, i) => <span key={i} />)}
        {days.map(d => (
          <button key={d} type="button" className={`calday ${d === now ? 'today' : ''}`} aria-pressed={d === value} aria-label={slash(d)} onClick={() => onPick(d)}>{parts(d)[2]}</button>
        ))}
      </div>
    </div>
  );
}

export function EntryForm({ app, editing, editRow, open, onClose }: { app: AppState; editing: Op | null; editRow: SheetRow | null; open: boolean; onClose: () => void }) {
  const { snap, prefs } = app;
  const items = snap.master.items.filter(i => !i.hidden);

  const himokuOf = (k: Kubun) => {
    const names = items.filter(i => i.kubun === k).sort((a, b) => a.order - b.order).map(i => i.himoku);
    for (const r of snap.rows) if (r.kubun === k && r.himoku && !names.includes(r.himoku)) names.push(r.himoku);
    return names;
  };
  const defaultHimoku = (k: Kubun) => {
    const list = himokuOf(k);
    return k === K_VAR && list.includes(prefs.defaultHimoku) ? prefs.defaultHimoku : list.find(h => k === K_VAR && /食費/.test(h)) ?? list[0] ?? '';
  };
  const fresh = (keep?: Partial<Draft>): Draft => ({
    opId: crypto.randomUUID(), txId: crypto.randomUUID(), date: today(), expr: '', kubun: K_VAR,
    himoku: defaultHimoku(K_VAR), himokuPicked: false, method: prefs.defaultMethod, place: '', sat: '', ...keep,
  });

  const [f, setF] = useState<Draft>(() => fresh());
  const [loaded, setLoaded] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [sheet, setSheet] = useState<'date' | 'method' | 'himoku' | null>(null);
  const set = (p: Partial<Draft>) => setF(x => ({ ...x, ...p }));

  // 開くたびに：修正なら対象の取引、入力途中の下書きがあればそれ、なければ設定の初期値から始める
  useEffect(() => {
    if (!open) { setLoaded(false); return; }
    setErrors({});
    if (editRow) {
      setF({ opId: crypto.randomUUID(), txId: editRow.id, date: editRow.date, expr: String(editRow.amount), kubun: editRow.kubun as Kubun, himoku: editRow.himoku, himokuPicked: true,
        method: editRow.method, place: editRow.g, sat: (SATISFACTION as readonly string[]).includes(editRow.sat) ? editRow.sat : '' });
      return;
    }
    if (editing) {
      const t = editing.tx;
      setF({ opId: editing.opId, txId: t.id, date: t.date, expr: String(t.amount), kubun: t.kubun, himoku: t.himoku, himokuPicked: true,
        method: t.method, place: [t.place, t.detail].filter(Boolean).join('／'), sat: t.sat });
      return;
    }
    getMeta<Draft | null>('draft', null).then(d => {
      setF(d && d.expr !== undefined && (d.expr || d.place || d.sat) ? d : fresh());
      setLoaded(true);
    });
  }, [open, editing, editRow]); // eslint-disable-line
  useEffect(() => { if (open && loaded && !editing && !editRow) setMeta('draft', f); }, [f, open, loaded, editing, editRow]);
  useEffect(() => { if (!f.himoku && items.length) setF(x => ({ ...x, himoku: defaultHimoku(x.kubun) })); }, [items.length]); // eslint-disable-line

  const history = useMemo(() => {
    const m = new Map<string, { place: string; kubun: string; himoku: string; date: string }>();
    for (const r of snap.rows) {
      const p = placeOf(r.g); if (!p || r.kubun === K_INC) continue;
      const k = normPlace(p), prev = m.get(k);
      if (!prev || r.date >= prev.date) m.set(k, { place: p, kubun: r.kubun, himoku: r.himoku, date: r.date });
    }
    return m;
  }, [snap.rows]);
  const typed = normPlace(f.place);
  const hints = typed ? [...history.values()].filter(h => normPlace(h.place).startsWith(typed) && normPlace(h.place) !== typed)
    .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3) : [];
  const guess = typed ? history.get(typed) : undefined;
  const canGuess = !!guess && guess.kubun === f.kubun && himokuOf(f.kubun).includes(guess.himoku);

  // 詳細から推測できたら費目を初期選択する。自分で選び直した後は上書きしない。
  useEffect(() => {
    if (f.himokuPicked) return;
    const h = canGuess ? guess!.himoku : defaultHimoku(f.kubun);
    if (h !== f.himoku) set({ himoku: h });
  }, [typed, f.kubun, f.himokuPicked]); // eslint-disable-line

  const himokuList = himokuOf(f.kubun);
  if (f.himoku && !himokuList.includes(f.himoku)) himokuList.unshift(f.himoku);
  const methods = useMemo(() => {
    const s = new Set<string>([...prefs.quickMethods, prefs.defaultMethod, ...snap.master.methods]);
    items.forEach(i => i.methods.forEach(m => s.add(m)));
    snap.master.hiddenMethods?.forEach(m => s.delete(m));
    snap.rows.forEach(r => r.method && s.add(r.method));
    return [...s].filter(Boolean);
  }, [prefs, snap, items]);
  // 支払方法の一覧は、よく使うものを先頭に
  const methodList = [...new Set([...prefs.quickMethods.filter(m => methods.includes(m)), ...methods])];

  // 費目は、よく使う順に7つだけ出す（並びは表示順のまま）。選んでいる費目は必ず含める。残りは「すべて」から。
  const uses = useMemo(() => {
    const n = new Map<string, number>();
    snap.rows.forEach(r => { if (r.kubun === f.kubun) n.set(r.himoku, (n.get(r.himoku) ?? 0) + 1); });
    return n;
  }, [snap.rows, f.kubun]);
  const topHimoku = (() => {
    if (himokuList.length <= TOP_HIMOKU + 1) return himokuList;
    const pick = [...himokuList].sort((a, b) => (uses.get(b) ?? 0) - (uses.get(a) ?? 0)).slice(0, TOP_HIMOKU);
    if (f.himoku && !pick.includes(f.himoku)) pick[TOP_HIMOKU - 1] = f.himoku;
    return himokuList.filter(h => pick.includes(h));
  })();
  const weekday = '日月火水木金土'[new Date(`${f.date}T00:00:00`).getDay()] ?? '';

  const amount = evaluate(f.expr);
  const key = (k: string) => { setErrors(e => ({ ...e, amount: '' })); setF(x => ({ ...x, expr: press(x.expr, k) })); };
  // ほかのアプリでコピーした金額（「¥1,280」「1280円」など）を貼り付ける
  const pasteAmount = (text: string) => {
    const m = text.normalize('NFKC').replace(/[¥\\,\s円]/g, '').match(/\d+(\.\d+)?/);
    if (!m) { setErrors(e => ({ ...e, amount: '貼り付けた内容に金額が見つかりません' })); return; }
    setErrors(e => ({ ...e, amount: '' }));
    set({ expr: String(Math.round(Number(m[0]))) });
  };
  async function pasteFromClipboard() {
    try { pasteAmount(await navigator.clipboard.readText()); }
    catch { setErrors(e => ({ ...e, amount: '貼り付けできませんでした。もう一度押して「ペースト」を選んでください' })); }
  }

  async function save(next: 'close' | 'continue') {
    if (saving) return;
    const errs: Record<string, string> = {};
    if (amount === null) errs.amount = '計算式を確認してください';
    else if (amount <= 0) errs.amount = '金額を入力してください';
    if (!isValidYmd(f.date)) errs.date = '日付を確認してください';
    if (!f.method) errs.method = '支払方法を選んでください';
    if (!f.himoku) errs.himoku = '費目を確認してください';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      const tx = { id: f.txId, date: f.date, amount: amount!, kubun: f.kubun, himoku: f.himoku, method: f.method, place: f.place.trim(), detail: '', sat: f.sat };
      if (editRow) {
        // 応答が届かず押し直しても、同じ内容なら同じ操作IDになり二重に処理されない
        const message = await app.applyEdit(`${f.opId}:${JSON.stringify(tx)}`, editRow, tx);
        if (message) setErrors({ submit: message }); else onClose();
        return;
      }
      // 操作IDは入力を始めた時点で決まっている。二重タップでも同じキーで上書きされ、1件のまま。
      await app.saveOp({ opId: f.opId, type: 'add', state: 'pending', createdAt: editing?.createdAt ?? Date.now(), tx });
      // 端末保存が完了してから入力欄を消す
      if (next === 'continue' && !editing) setF(fresh({ date: f.date, method: f.method }));
      else { if (!editing) await setMeta('draft', null); onClose(); }
    } finally { setSaving(false); }
  }

  async function remove() {
    if (saving || !editRow || !confirm('この取引をスプレッドシートから削除しますか？')) return;
    setSaving(true);
    try {
      const message = await app.applyEdit(`${f.opId}:delete`, editRow, null);
      if (message) setErrors({ submit: message }); else onClose();
    } finally { setSaving(false); }
  }

  function onKey(e: KeyboardEvent) {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    const map: Record<string, string> = { '+': '+', '-': '−', '*': '×', '/': '÷', Backspace: 'back', Delete: 'clear', '=': '=' };
    const k = /^\d$/.test(e.key) ? e.key : map[e.key];
    if (k) { e.preventDefault(); key(k); }
    else if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON') { e.preventDefault(); save('close'); }
  }

  const kind = EXPENSE.includes(f.kubun) ? K_VAR : f.kubun;
  const tile = (h: string, after?: () => void) => {
    const I = iconFor(h);
    return <button key={h} type="button" className="tile" aria-pressed={f.himoku === h} onClick={() => { set({ himoku: h, himokuPicked: true }); after?.(); }}>
      <I size={20} strokeWidth={2} aria-hidden="true" /><span>{displayName(h)}</span></button>;
  };
  return (
    <Dialog.Root open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="sheet entry" aria-describedby={undefined} onKeyDown={onKey}
          onPaste={e => { if ((e.target as HTMLElement).tagName === 'INPUT') return; e.preventDefault(); pasteAmount(e.clipboardData.getData('text')); }}>
          <Dialog.Title className="sr">{editing ? '未送信の取引を修正' : editRow ? '取引を修正' : '入力'}</Dialog.Title>
          <div className="entry-scroll">
            <div className="tabrow">
              <div className="tabs kubunrow" role="group" aria-label="区分">
                {KUBUN_ROW.map(([label, k]) => (
                  <button key={k} type="button" aria-pressed={f.kubun === k} aria-label={KUBUN_LABEL[k]} onClick={() => set({ kubun: k, himoku: defaultHimoku(k), himokuPicked: false })}>{label}</button>
                ))}
              </div>
              <Dialog.Close className="iconbtn" aria-label="閉じる"><X size={20} strokeWidth={2} /></Dialog.Close>
            </div>
            {editing && <p className="hint">未送信の取引を修正中</p>}
            {editRow && <p className="hint">送信済みの取引を修正中</p>}

            <div className="amountbox" aria-live="polite">
              <button type="button" className="pastebtn" onClick={pasteFromClipboard}><ClipboardPaste size={18} strokeWidth={2} aria-hidden="true" />貼り付け</button>
              {hasOperator(f.expr) && <div className="muted num">{formatExpr(f.expr)}</div>}
              <div className={`big num ${f.expr ? '' : 'placeholder'}`}><span className="sr">金額 </span>{amount === null ? '—' : yen(amount)}</div>
              {errors.amount && <p className="err"><CircleAlert size={16} />{errors.amount}</p>}
            </div>

            <div className="field" role="group" aria-labelledby="l-himoku">
              <span className="label" id="l-himoku">費目</span>
              <div className="tiles">
                {topHimoku.map(h => tile(h))}
                {topHimoku.length < himokuList.length && (
                  <button type="button" className="tile more" onClick={() => setSheet('himoku')}><LayoutGrid size={20} strokeWidth={2} aria-hidden="true" /><span>すべて</span></button>
                )}
              </div>
              {canGuess && !f.himokuPicked && f.himoku === guess!.himoku && <p className="hint">利用履歴から推測</p>}
              {errors.himoku && <p className="err"><CircleAlert size={16} />{errors.himoku}</p>}
            </div>

            <div className="pickrow">
              <button type="button" className="input pickbtn num" onClick={() => setSheet('date')} aria-label={`日付 ${slash(f.date)}。カレンダーを開く`}>
                <CalendarDays size={20} strokeWidth={2} aria-hidden="true" /><span>{f.date === today() ? '今日' : slash(f.date).slice(5)}（{weekday}）</span>
              </button>
              <button type="button" className="input pickbtn" onClick={() => setSheet('method')} aria-label={`支払方法 ${f.method || '未選択'}。選び直す`}>
                <CreditCard size={20} strokeWidth={2} aria-hidden="true" /><span className="ellipsis">{f.method || '支払方法'}</span><ChevronDown size={16} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
            {errors.date && <p className="err"><CircleAlert size={16} />{errors.date}</p>}
            {errors.method && <p className="err"><CircleAlert size={16} />{errors.method}</p>}

            <div className="line">
              <label className="label" htmlFor="place">詳細</label>
              <input id="place" className="input" value={f.place} autoComplete="off" enterKeyHint="done"
                onChange={e => set({ place: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }} />
            </div>
            {hints.length > 0 && (
              <div className="scroll1 hints" aria-label="利用履歴の候補">
                {hints.map(h => <button key={h.place} type="button" className="chip ghost" onClick={() => set({ place: h.place })}>{h.place}</button>)}
              </div>
            )}

            {kind === K_VAR && (
              <div className="line" role="group" aria-labelledby="l-sat">
                <span className="label" id="l-sat">満足度</span>
                <div className="chips">
                  {SATISFACTION.map(s => <button key={s} type="button" className="chip sat" aria-pressed={f.sat === s} onClick={() => set({ sat: f.sat === s ? '' : s })}>{s}</button>)}
                </div>
              </div>
            )}
          </div>

          {errors.submit && <p className="err submit-err" role="alert"><CircleAlert size={16} aria-hidden="true" />{errors.submit}</p>}
          <div className="keypad" role="group" aria-label="電卓">
            {KEYS.map(k => (
              <button key={k} type="button" className={'+−='.includes(k) ? 'op' : k === 'clear' || k === 'back' ? 'fn' : ''}
                aria-label={KEY_LABEL[k] ?? k} onClick={() => key(k)}>
                {k === 'back' ? <Delete size={20} strokeWidth={2} aria-hidden="true" /> : k === 'clear' ? 'C' : k}
              </button>
            ))}
          </div>
          <div className="saverow">
            {editRow ? <button type="button" className="del" disabled={saving} onClick={remove}>削除</button>
              : editing ? null : <button type="button" className="next" disabled={saving} onClick={() => save('continue')}>続けて入力</button>}
            <button type="button" className="go" disabled={saving} onClick={() => save('close')}>{editing || editRow ? '保存' : '登録'}</button>
          </div>

          <Sheet open={sheet === 'date'} onOpenChange={o => setSheet(o ? 'date' : null)} title="日付">
            <CalendarPicker value={f.date} onPick={d => { set({ date: d }); setSheet(null); }} />
          </Sheet>
          <Sheet open={sheet === 'method'} onOpenChange={o => setSheet(o ? 'method' : null)} title="支払方法">
            <PickList items={methodList} selected={f.method} onPick={m => { set({ method: m }); setSheet(null); }} />
          </Sheet>
          <Sheet open={sheet === 'himoku'} onOpenChange={o => setSheet(o ? 'himoku' : null)} title="費目">
            <div className="tiles">{himokuList.map(h => tile(h, () => setSheet(null)))}</div>
          </Sheet>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
