import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { parts, slash, today, weekdayMon } from '../lib/date';
import { displayName, iconFor, KUBUN_LABEL, yen } from '../lib/display';
import type { AppState } from '../lib/store';
import { K_INC, KUBUN, type Op, type SheetRow } from '../lib/types';

type Item = { key: string; date: string; amount: number; kubun: string; himoku: string; method: string; g: string; sat: string; row?: SheetRow; op?: Op };

const WD = '月火水木金土日';
const norm = (s: string) => s.normalize('NFKC').toLowerCase();
const MAX_DAYS = 100;
const STATE: Record<Op['state'], string> = { pending: '未送信', unknown: '送信確認中', failed: '受付不可' };

export function List({ app, onEditRow, onEditOp }: { app: AppState; onEditRow: (r: SheetRow) => void; onEditOp: (o: Op) => void }) {
  const { snap, ops } = app;
  const [y0, m0] = parts(today());
  const [ym, setYm] = useState<[number, number]>([y0, m0]);
  const [filter, setFilter] = useState('');
  const [q, setQ] = useState('');

  const all = useMemo<Item[]>(() => {
    const ids = new Set(snap.rows.map(r => r.id));
    return [
      ...snap.rows.map(r => ({ key: r.id, date: r.date, amount: r.amount, kubun: r.kubun, himoku: r.himoku, method: r.method, g: r.g, sat: r.sat, row: r })),
      ...ops.filter(o => !ids.has(o.tx.id)).map(o => ({ key: o.opId, date: o.tx.date, amount: o.tx.amount, kubun: o.tx.kubun, himoku: o.tx.himoku, method: o.tx.method,
        g: [o.tx.place, o.tx.detail].filter(Boolean).join('／'), sat: o.tx.sat, op: o })),
    ];
  }, [snap.rows, ops]);

  const move = (d: number) => setYm(([y, m]) => { const t = new Date(y, m - 1 + d, 1); return [t.getFullYear(), t.getMonth() + 1]; });
  const prefix = `${ym[0]}-${String(ym[1]).padStart(2, '0')}`;
  const needle = norm(q.trim());
  // 検索は全期間、検索していないときは表示中の月だけ
  const shown = all.filter(i => (needle ? norm(`${i.himoku} ${i.g} ${i.method}`).includes(needle) : i.date.startsWith(prefix)) && (!filter || i.kubun === filter));
  const days = new Map<string, Item[]>();
  [...shown].sort((a, b) => b.date.localeCompare(a.date)).forEach(i => days.set(i.date, [...(days.get(i.date) ?? []), i]));
  const groups = [...days].slice(0, MAX_DAYS);
  const spent = (l: Item[]) => l.filter(i => i.kubun.startsWith('支出')).reduce((s, i) => s + i.amount, 0);

  function open(i: Item) {
    if (i.op) { if (i.op.state === 'unknown') app.setNotice({ text: '送信の確認中です。同期が終わるまでお待ちください', kind: 'info' }); else onEditOp(i.op); return; }
    if (!app.online) { app.setNotice({ text: '送信済みの取引の修正はオンライン時にできます', kind: 'error' }); return; }
    if (i.amount <= 0) { app.setNotice({ text: '返金など0円以下の取引は、スプレッドシートで修正してください', kind: 'error' }); return; }
    onEditRow(i.row!);
  }

  return (
    <div>
      <div className="row" style={{ alignItems: 'center' }}>
        <button type="button" className="iconbtn" aria-label="前の月" disabled={!!needle} onClick={() => move(-1)}><ChevronLeft size={24} strokeWidth={2} /></button>
        <b className="num">{needle ? '全期間' : `${ym[0]}/${String(ym[1]).padStart(2, '0')}`}</b>
        <button type="button" className="iconbtn" aria-label="次の月" disabled={!!needle} onClick={() => move(1)}><ChevronRight size={24} strokeWidth={2} /></button>
      </div>
      <label className="searchbox">
        <Search size={24} strokeWidth={2} aria-hidden="true" />
        <span className="sr">検索</span>
        <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="検索" autoComplete="off" />
      </label>
      <div className="filters" role="group" aria-label="区分で絞り込み">
        <button type="button" aria-pressed={!filter} onClick={() => setFilter('')}>すべて</button>
        {KUBUN.map(k => <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(filter === k ? '' : k)}>{KUBUN_LABEL[k]}</button>)}
      </div>

      <p className="muted num" role="status">{shown.length}件　支出 {yen(spent(shown))}{days.size > MAX_DAYS ? `　新しい${MAX_DAYS}日分を表示` : ''}</p>
      {!shown.length && <p className="muted section">{snap.fetchedAt || snap.rows.length ? '該当する取引はありません' : 'スプレッドシートの取得前です'}</p>}

      {groups.map(([date, list]) => (
        <section key={date} className="section">
          <div className="row dayhead"><b className="num">{slash(date)}（{WD[weekdayMon(date)]}）</b><span className="muted num">{spent(list) ? yen(spent(list)) : ''}</span></div>
          <div className="list">
            {list.map(i => {
              const I = iconFor(i.himoku);
              return (
                <button key={i.key} type="button" className="li pick txrow" onClick={() => open(i)}>
                  <I size={24} strokeWidth={2} aria-hidden="true" />
                  <span className="grow">
                    <span className="txname">{displayName(i.himoku)}{i.op && <span className="tag">{STATE[i.op.state]}</span>}</span>
                    <span className="muted txsub">{[KUBUN_LABEL[i.kubun] ?? i.kubun, i.method, i.g].filter(Boolean).join('・')}</span>
                  </span>
                  <span className="txamt num">{i.kubun === K_INC ? '+' : ''}{yen(i.amount)}{i.sat && i.sat !== 'ー' && <span className="muted">{i.sat}</span>}</span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
