import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CircleAlert, MoreHorizontal } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { getMeta, setMeta } from '../lib/db';
import { isValidYmd, parts, slash, today, ymd } from '../lib/date';
import { displayName, iconFor, KUBUN_LABEL } from '../lib/display';
import type { AppState } from '../lib/store';
import { K_VAR, KUBUN, SATISFACTION, type Kubun, type Op } from '../lib/types';
import { PickList, Sheet } from './Sheet';

interface Draft {
  opId: string; txId: string; date: string; digits: string; kubun: Kubun; himoku: string; himokuPicked: boolean;
  method: string; place: string; detail: string; sat: string; more: boolean;
}

const placeOf = (g: string) => g.split('／')[0].trim();
const normPlace = (s: string) => s.normalize('NFKC').trim().toLowerCase();

function shiftDay(s: string, delta: number) {
  const [y, m, d] = parts(s);
  const t = new Date(y, m - 1, d + delta);
  return ymd(t.getFullYear(), t.getMonth() + 1, t.getDate());
}

export function EntryForm({ app, editing, onDoneEditing }: { app: AppState; editing: Op | null; onDoneEditing: () => void }) {
  const { snap, prefs } = app;
  const items = snap.master.items;

  const himokuOf = (k: Kubun) => {
    const names = items.filter(i => i.kubun === k).sort((a, b) => a.order - b.order).map(i => i.himoku);
    for (const r of snap.rows) if (r.kubun === k && r.himoku && !names.includes(r.himoku)) names.push(r.himoku);
    return names;
  };
  const defaultHimoku = (k: Kubun) => {
    const list = himokuOf(k);
    return k === K_VAR && list.includes(prefs.defaultHimoku) ? prefs.defaultHimoku : list.find(h => /食費/.test(h) && k === K_VAR) ?? list[0] ?? '';
  };
  // 次の新規入力は「設定の初期値」を基準にする。日付と支払方法は、続けて入力する間だけ引き継ぐ。
  const fresh = (keep?: Partial<Draft>): Draft => ({
    opId: crypto.randomUUID(), txId: crypto.randomUUID(), date: today(), digits: '', kubun: K_VAR,
    himoku: defaultHimoku(K_VAR), himokuPicked: false, method: prefs.defaultMethod, place: '', detail: '', sat: '', more: false, ...keep,
  });

  const [f, setF] = useState<Draft>(() => fresh());
  const [loaded, setLoaded] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [sheet, setSheet] = useState<'himoku' | 'method' | null>(null);

  // 下書きの保持：画面移動・再読み込みでも入れ直さなくてよいように
  useEffect(() => { getMeta<Draft | null>('draft', null).then(d => { if (d) setF(d); setLoaded(true); }); }, []);
  useEffect(() => { if (loaded && !editing) setMeta('draft', f); }, [f, loaded, editing]);
  useEffect(() => {
    if (!editing) return;
    const t = editing.tx;
    setF({ opId: editing.opId, txId: t.id, date: t.date, digits: String(t.amount), kubun: t.kubun, himoku: t.himoku, himokuPicked: true,
      method: t.method, place: t.place, detail: t.detail, sat: t.sat, more: !!(t.detail || t.sat) });
  }, [editing]);
  // マスターを初めて取得したときに、費目が空なら初期値を入れる
  useEffect(() => { if (!f.himoku && items.length) setF(x => ({ ...x, himoku: defaultHimoku(x.kubun) })); }, [items.length]); // eslint-disable-line

  const set = (p: Partial<Draft>) => setF(x => ({ ...x, ...p }));

  // 利用履歴：利用先 → 最新の区分・費目
  const history = useMemo(() => {
    const m = new Map<string, { place: string; kubun: string; himoku: string; date: string }>();
    for (const r of snap.rows) {
      const p = placeOf(r.g); if (!p || r.kubun === '収入') continue;
      const k = normPlace(p), prev = m.get(k);
      if (!prev || r.date >= prev.date) m.set(k, { place: p, kubun: r.kubun, himoku: r.himoku, date: r.date });
    }
    return m;
  }, [snap.rows]);

  const typed = normPlace(f.place);
  const placeHints = typed ? [...history.values()].filter(h => normPlace(h.place).startsWith(typed) && normPlace(h.place) !== typed)
    .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3) : [];
  const guess = typed ? history.get(typed) : undefined;
  const guessed = !!guess && !f.himokuPicked && guess.kubun === f.kubun && himokuOf(f.kubun).includes(guess.himoku);

  // 利用先から推測できたら費目を初期選択する。自分で選び直した後は上書きしない。
  useEffect(() => {
    if (f.himokuPicked) return;
    const h = guess && guess.kubun === f.kubun && himokuOf(f.kubun).includes(guess.himoku) ? guess.himoku : defaultHimoku(f.kubun);
    if (h !== f.himoku) set({ himoku: h });
  }, [typed, f.kubun, f.himokuPicked]); // eslint-disable-line

  const usage = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of snap.rows) c.set(r.himoku, (c.get(r.himoku) || 0) + 1);
    return c;
  }, [snap.rows]);
  const himokuList = himokuOf(f.kubun);
  const quickHimoku = [...himokuList].sort((a, b) => (usage.get(b) || 0) - (usage.get(a) || 0)).slice(0, 5);
  if (f.himoku && !quickHimoku.includes(f.himoku)) quickHimoku.splice(4, 1, f.himoku);

  const methods = useMemo(() => {
    const s = new Set<string>([...prefs.quickMethods, prefs.defaultMethod, ...snap.master.methods]);
    items.forEach(i => i.methods.forEach(m => s.add(m)));
    snap.rows.forEach(r => r.method && s.add(r.method));
    return [...s].filter(Boolean);
  }, [prefs, snap, items]);
  const quickMethods = prefs.quickMethods.includes(f.method) || !f.method ? prefs.quickMethods : [...prefs.quickMethods.slice(0, 2), f.method];

  const amount = Number(f.digits || 0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    const errs: Record<string, string> = {};
    if (!amount) errs.amount = '金額を入力してください';
    if (!isValidYmd(f.date)) errs.date = '日付を確認してください';
    if (!f.method) errs.method = '支払方法を選んでください';
    if (!f.himoku) errs.himoku = '費目を確認してください';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      // 操作IDは入力を始めた時点で決まっている。二重タップ・再送でも同じキーで上書きされ、1件のまま。
      await app.saveOp({ opId: f.opId, type: 'add', state: 'pending', createdAt: editing?.createdAt ?? Date.now(),
        tx: { id: f.txId, date: f.date, amount, kubun: f.kubun, himoku: f.himoku, method: f.method, place: f.place.trim(), detail: f.detail.trim(), sat: f.sat } });
      // 端末保存が完了してから入力欄を消す
      if (editing) { onDoneEditing(); setF(fresh()); }
      else setF(fresh({ date: f.date, method: f.method }));
    } finally { setSaving(false); }
  }

  return (
    <form onSubmit={submit} noValidate aria-label="支出入力">
      {editing && (
        <div className="row card tint" style={{ alignItems: 'center' }}>
          <span>未送信の取引を修正中</span>
          <button type="button" className="secondary" onClick={() => { onDoneEditing(); setF(fresh()); }}>修正をやめる</button>
        </div>
      )}

      <div className="field">
        <label htmlFor="amount">金額</label>
        <input id="amount" className="input amount" inputMode="numeric" autoComplete="off" enterKeyHint="done"
          value={f.digits ? '¥' + amount.toLocaleString('ja-JP') : ''} placeholder="¥0" aria-invalid={!!errors.amount}
          aria-describedby={errors.amount ? 'e-amount' : undefined}
          onChange={e => set({ digits: e.target.value.replace(/[^\d]/g, '').replace(/^0+/, '').slice(0, 9) })} />
        {errors.amount && <p className="err" id="e-amount"><CircleAlert size={16} />{errors.amount}</p>}
      </div>

      <div className="field">
        <label htmlFor="date">日付</label>
        <div className="datebox">
          <span className="input shown num" aria-hidden="true">{slash(f.date)}</span>
          <input id="date" type="date" value={f.date} onChange={e => e.target.value && set({ date: e.target.value })} aria-invalid={!!errors.date} />
          <button type="button" className="iconbtn" aria-label="前日" onClick={() => set({ date: shiftDay(f.date, -1) })}><ChevronLeft size={24} strokeWidth={2} /></button>
          <button type="button" className="iconbtn" aria-label="翌日" onClick={() => set({ date: shiftDay(f.date, 1) })}><ChevronRight size={24} strokeWidth={2} /></button>
        </div>
        {errors.date && <p className="err"><CircleAlert size={16} />{errors.date}</p>}
      </div>

      <div className="field" role="group" aria-labelledby="l-kubun">
        <span className="label" id="l-kubun">区分</span>
        <div className="chips">
          {KUBUN.map(k => (
            <button key={k} type="button" className="chip" aria-pressed={f.kubun === k}
              onClick={() => set({ kubun: k, himoku: defaultHimoku(k), himokuPicked: false })}>{KUBUN_LABEL[k]}</button>
          ))}
        </div>
      </div>

      <div className="field" role="group" aria-labelledby="l-himoku">
        <span className="label" id="l-himoku">費目</span>
        <div className="chips">
          {quickHimoku.map(h => {
            const I = iconFor(h);
            return <button key={h} type="button" className="chip" aria-pressed={f.himoku === h}
              onClick={() => set({ himoku: h, himokuPicked: true })}><I size={24} strokeWidth={2} aria-hidden="true" />{displayName(h)}</button>;
          })}
          {himokuList.length > quickHimoku.length && (
            <button type="button" className="chip" onClick={() => setSheet('himoku')}><MoreHorizontal size={24} strokeWidth={2} aria-hidden="true" />ほかの費目</button>
          )}
        </div>
        {guessed && f.himoku === guess!.himoku && <p className="hint">利用履歴から推測</p>}
        {errors.himoku && <p className="err"><CircleAlert size={16} />{errors.himoku}</p>}
      </div>

      <div className="field">
        <label htmlFor="place">利用先・支払先</label>
        <input id="place" className="input" value={f.place} autoComplete="off" enterKeyHint="done"
          onChange={e => set({ place: e.target.value })} />
        {placeHints.length > 0 && (
          <div className="chips" aria-label="利用履歴の候補">
            {placeHints.map(h => (
              <button key={h.place} type="button" className="chip ghost" onClick={() => set({ place: h.place })}>{h.place}</button>
            ))}
          </div>
        )}
      </div>

      <div className="field" role="group" aria-labelledby="l-method">
        <span className="label" id="l-method">支払方法</span>
        <div className="chips">
          {quickMethods.map(m => (
            <button key={m} type="button" className="chip" aria-pressed={f.method === m} onClick={() => set({ method: m })}>{m}</button>
          ))}
          <button type="button" className="chip" onClick={() => setSheet('method')}><MoreHorizontal size={24} strokeWidth={2} aria-hidden="true" />その他</button>
        </div>
        {errors.method && <p className="err"><CircleAlert size={16} />{errors.method}</p>}
      </div>

      <button type="button" className="toggle" aria-expanded={f.more} onClick={() => set({ more: !f.more })}>
        <span>詳細・満足度{(f.detail || f.sat) && !f.more ? '（入力あり）' : ''}</span>
        {f.more ? <ChevronUp size={24} strokeWidth={2} /> : <ChevronDown size={24} strokeWidth={2} />}
      </button>
      {f.more && (
        <>
          <div className="field">
            <label htmlFor="detail">詳細</label>
            <input id="detail" className="input" value={f.detail} onChange={e => set({ detail: e.target.value })} />
          </div>
          <div className="field" role="group" aria-labelledby="l-sat">
            <span className="label" id="l-sat">満足度</span>
            <div className="chips">
              {SATISFACTION.map(s => (
                <button key={s} type="button" className="chip" aria-pressed={f.sat === s} onClick={() => set({ sat: f.sat === s ? '' : s })}>{s}</button>
              ))}
            </div>
          </div>
        </>
      )}

      <button type="submit" className="primary" disabled={saving}>
        {editing ? '修正を保存する' : '登録する'}
      </button>
      <p className="sr" aria-live="polite">{saving ? '保存中' : ''}</p>

      <Sheet open={sheet === 'himoku'} onOpenChange={o => setSheet(o ? 'himoku' : null)} title={`費目（${KUBUN_LABEL[f.kubun]}）`}>
        <PickList items={himokuList} selected={f.himoku} onPick={h => { set({ himoku: h, himokuPicked: true }); setSheet(null); }}
          render={h => { const I = iconFor(h); return <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}><I size={24} strokeWidth={2} aria-hidden="true" />{displayName(h)}</span>; }} />
      </Sheet>
      <Sheet open={sheet === 'method'} onOpenChange={o => setSheet(o ? 'method' : null)} title="支払方法">
        <PickList items={methods} selected={f.method} onPick={m => { set({ method: m }); setSheet(null); }} />
      </Sheet>
    </form>
  );
}
