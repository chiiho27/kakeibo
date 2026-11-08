import * as Dialog from '@radix-ui/react-dialog';
import { CalendarDays, ChevronLeft, ChevronRight, CircleAlert, Delete, MoreHorizontal, X } from 'lucide-react';
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { evaluate, formatExpr, hasOperator, press } from '../lib/calc';
import { daysInMonth, isValidYmd, parts, slash, today, weekdayMon, ymd } from '../lib/date';
import { getMeta, setMeta } from '../lib/db';
import { displayName, iconFor, KUBUN_LABEL, yen } from '../lib/display';
import type { AppState } from '../lib/store';
import { K_INC, K_SAVE, K_VAR, SATISFACTION, type Kubun, type Op } from '../lib/types';
import { PickList, Sheet } from './Sheet';

interface Draft {
  opId: string; txId: string; date: string; expr: string; kubun: Kubun; himoku: string; himokuPicked: boolean;
  method: string; place: string; sat: string;
}

const EXPENSE: Kubun[] = ['支出（変動費）', '支出（固定費）', '支出（特別費）'];
const KINDS: [string, Kubun][] = [['支出', K_VAR], ['収入', K_INC], ['貯蓄・投資', K_SAVE]];
const placeOf = (g: string) => g.split('／')[0].trim();
const normPlace = (s: string) => s.normalize('NFKC').trim().toLowerCase();
const KEYS = ['7', '8', '9', '÷', '4', '5', '6', '×', '1', '2', '3', '−', '0', '00', 'back', '+'];

function CalendarPicker({ value, onPick }: { value: string; onPick: (d: string) => void }) {
  const [v, setV] = useState<[number, number]>(() => { const [y, m] = parts(value); return [y, m]; });
  const [y, m] = v;
  const move = (d: number) => setV(([yy, mm]) => { const t = new Date(yy, mm - 1 + d, 1); return [t.getFullYear(), t.getMonth() + 1]; });
  const days = Array.from({ length: daysInMonth(y, m) }, (_, i) => ymd(y, m, i + 1));
  const now = today();
  return (
    <div>
      <div className="row" style={{ alignItems: 'center' }}>
        <button type="button" className="iconbtn" aria-label="前の月" onClick={() => move(-1)}><ChevronLeft size={24} strokeWidth={2} /></button>
        <b className="num">{y}/{String(m).padStart(2, '0')}</b>
        <button type="button" className="iconbtn" aria-label="次の月" onClick={() => move(1)}><ChevronRight size={24} strokeWidth={2} /></button>
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

export function EntryForm({ app, editing, open, onClose }: { app: AppState; editing: Op | null; open: boolean; onClose: () => void }) {
  const { snap, prefs } = app;
  const items = snap.master.items;

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
  const [sheet, setSheet] = useState<'date' | 'method' | null>(null);
  const set = (p: Partial<Draft>) => setF(x => ({ ...x, ...p }));

  // 開くたびに：修正なら対象の取引、入力途中の下書きがあればそれ、なければ設定の初期値から始める
  useEffect(() => {
    if (!open) { setLoaded(false); return; }
    setErrors({});
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
  }, [open, editing]); // eslint-disable-line
  useEffect(() => { if (open && loaded && !editing) setMeta('draft', f); }, [f, open, loaded, editing]);
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
    snap.rows.forEach(r => r.method && s.add(r.method));
    return [...s].filter(Boolean);
  }, [prefs, snap, items]);
  const quickMethods = prefs.quickMethods.includes(f.method) || !f.method ? prefs.quickMethods : [f.method, ...prefs.quickMethods.slice(0, 2)];

  const amount = evaluate(f.expr);
  const key = (k: string) => { setErrors(e => ({ ...e, amount: '' })); setF(x => ({ ...x, expr: press(x.expr, k) })); };

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
      // 操作IDは入力を始めた時点で決まっている。二重タップでも同じキーで上書きされ、1件のまま。
      await app.saveOp({ opId: f.opId, type: 'add', state: 'pending', createdAt: editing?.createdAt ?? Date.now(),
        tx: { id: f.txId, date: f.date, amount: amount!, kubun: f.kubun, himoku: f.himoku, method: f.method, place: f.place.trim(), detail: '', sat: f.sat } });
      // 端末保存が完了してから入力欄を消す
      if (next === 'continue' && !editing) setF(fresh({ date: f.date, method: f.method }));
      else { if (!editing) await setMeta('draft', null); onClose(); }
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
  return (
    <Dialog.Root open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="sheet entry" aria-describedby={undefined} onKeyDown={onKey}>
          <Dialog.Title className="sr">{editing ? '未送信の取引を修正' : '入力'}</Dialog.Title>
          <div className="entry-scroll">
            <div className="tabrow">
              <div className="tabs" role="group" aria-label="種類">
                {KINDS.map(([label, k]) => (
                  <button key={label} type="button" aria-pressed={kind === k} onClick={() => set({ kubun: k, himoku: defaultHimoku(k), himokuPicked: false })}>{label}</button>
                ))}
              </div>
              <Dialog.Close className="iconbtn" aria-label="閉じる"><X size={24} strokeWidth={2} /></Dialog.Close>
            </div>
            {editing && <p className="hint">未送信の取引を修正中</p>}
            {kind === K_VAR && (
              <div className="tabs sub" role="group" aria-label="区分">
                {EXPENSE.map(k => (
                  <button key={k} type="button" aria-pressed={f.kubun === k} onClick={() => set({ kubun: k, himoku: defaultHimoku(k), himokuPicked: false })}>{KUBUN_LABEL[k]}</button>
                ))}
              </div>
            )}

            <div className="amountbox" aria-live="polite">
              {hasOperator(f.expr) && <div className="muted num">{formatExpr(f.expr)}</div>}
              <div className={`big num ${f.expr ? '' : 'placeholder'}`}><span className="sr">金額 </span>{amount === null ? '—' : yen(amount)}</div>
              {errors.amount && <p className="err"><CircleAlert size={16} />{errors.amount}</p>}
            </div>

            <div className="field" role="group" aria-labelledby="l-himoku">
              <span className="label" id="l-himoku">費目</span>
              <div className="scroll2">
                {himokuList.map(h => {
                  const I = iconFor(h);
                  return <button key={h} type="button" className="chip" aria-pressed={f.himoku === h} onClick={() => set({ himoku: h, himokuPicked: true })}>
                    <I size={24} strokeWidth={2} aria-hidden="true" />{displayName(h)}</button>;
                })}
              </div>
              {canGuess && !f.himokuPicked && f.himoku === guess!.himoku && <p className="hint">利用履歴から推測</p>}
              {errors.himoku && <p className="err"><CircleAlert size={16} />{errors.himoku}</p>}
            </div>

            <div className="line">
              <span className="label">日付</span>
              <button type="button" className="input datebtn num" onClick={() => setSheet('date')} aria-label={`日付 ${slash(f.date)}。カレンダーを開く`}>
                {slash(f.date)}<CalendarDays size={24} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
            {errors.date && <p className="err"><CircleAlert size={16} />{errors.date}</p>}

            <div className="line" role="group" aria-labelledby="l-method">
              <span className="label" id="l-method">支払方法</span>
              <div className="scroll1">
                {quickMethods.map(m => <button key={m} type="button" className="chip" aria-pressed={f.method === m} onClick={() => set({ method: m })}>{m}</button>)}
                <button type="button" className="chip" onClick={() => setSheet('method')}><MoreHorizontal size={24} strokeWidth={2} aria-hidden="true" />その他</button>
              </div>
            </div>
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

          <div className="keypad" role="group" aria-label="電卓">
            {KEYS.map(k => (
              <button key={k} type="button" className={'+−×÷'.includes(k) ? 'op' : ''} aria-label={k === 'back' ? '1文字消す' : k} onClick={() => key(k)}>
                {k === 'back' ? <Delete size={24} strokeWidth={2} aria-hidden="true" /> : k}
              </button>
            ))}
            <button type="button" className="op" aria-label="全部消す" onClick={() => key('clear')}>C</button>
            <button type="button" className="op" onClick={() => key('=')}>=</button>
            {editing ? <span /> : <button type="button" className="next" disabled={saving} onClick={() => save('continue')}>続けて</button>}
            <button type="button" className="go" disabled={saving} onClick={() => save('close')}>{editing ? '保存' : '登録'}</button>
          </div>

          <Sheet open={sheet === 'date'} onOpenChange={o => setSheet(o ? 'date' : null)} title="日付">
            <CalendarPicker value={f.date} onPick={d => { set({ date: d }); setSheet(null); }} />
          </Sheet>
          <Sheet open={sheet === 'method'} onOpenChange={o => setSheet(o ? 'method' : null)} title="支払方法">
            <PickList items={methods} selected={f.method} onPick={m => { set({ method: m }); setSheet(null); }} />
          </Sheet>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
