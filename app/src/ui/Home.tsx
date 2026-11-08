import { CircleAlert, CircleCheck, Heart, Leaf, Smile, Sprout, Star, type LucideIcon } from 'lucide-react';
import { isNoMoneyDay, monthTotals, unsentTxs, weekStatus } from '../lib/budget';
import { parts, today } from '../lib/date';
import { yen } from '../lib/display';
import type { AppState } from '../lib/store';
import type { Op } from '../lib/types';
import { EntryForm } from './EntryForm';

const NMD: Record<string, LucideIcon> = { sprout: Sprout, leaf: Leaf, star: Star, smile: Smile, 'circle-check': CircleCheck, heart: Heart };

export function NmdMark({ icon, size = 24 }: { icon: string; size?: number }) {
  if (!icon.startsWith('lucide:')) return <span aria-hidden="true" style={{ fontSize: size * 0.9, lineHeight: 1 }}>{icon}</span>;
  const I = NMD[icon.slice(7)] ?? Sprout;
  return <I size={size} strokeWidth={2} aria-hidden="true" />;
}

const WD = ['月', '火', '水', '木', '金', '土', '日'];

export function Home({ app, editing, onDoneEditing }: { app: AppState; editing: Op | null; onDoneEditing: () => void }) {
  const { snap, ops, prefs } = app;
  const day = today();
  const [y, m] = parts(day);
  const ym = `${y}-${String(m).padStart(2, '0')}`;
  const unsent = unsentTxs(ops, snap.rows);
  const w = weekStatus(snap.master, snap.rows, unsent, day);
  const confirmed = monthTotals(snap.rows, ym);
  const withUnsent = monthTotals([...snap.rows, ...unsent], ym);
  const hasData = snap.rows.length > 0 || snap.master.items.length > 0;
  const all = [...snap.rows, ...unsent];

  return (
    <div className="home">
        <section className="section card tint area-week" aria-labelledby="h-week">
          <h2 id="h-week">今週あと使える金額</h2>
          {!hasData ? <p className="muted">スプレッドシートの取得前です</p>
            : !w.hasWeeklyItems ? <p className="muted">週管理の費目が設定されていません</p> : (
            <>
              <div className={`big num ${w.left < 0 ? 'over' : ''}`}>{yen(w.left)}</div>
              {w.left < 0 && <p className="err"><CircleAlert size={16} />予算を {yen(-w.left)} 超えています</p>}
              <div className="row muted num"><span>週の予算（{w.week.days.length}日分）</span><span>{yen(w.budget)}</span></div>
              <div className="row muted num"><span>使った金額{snap.fetchedAt ? `（${snap.fetchedAt} 時点）` : ''}</span><span>{yen(w.confirmed)}</span></div>
              {w.unsent > 0 && <div className="row muted num"><span>未送信分</span><span>{yen(w.unsent)}</span></div>}
              {w.left > 0 && w.daysLeft > 0 && <div className="row muted num"><span>1日あたり（残り{w.daysLeft}日）</span><span>{yen(w.left / w.daysLeft)}</span></div>}
            </>
          )}
          <div className="days" aria-label="今週の記録">
            {w.week.days.map(d => {
              const nmd = isNoMoneyDay(all, d, day);
              return (
                <div key={d} className={`d ${d === day ? 'today' : ''}`}>
                  <span className="muted">{WD[(new Date(...(parts(d).map((v, i) => i === 1 ? v - 1 : v)) as [number, number, number]).getDay() + 6) % 7]}</span>
                  <b className="num">{parts(d)[2]}</b>
                  <span style={{ minHeight: 24 }}>{nmd ? <><NmdMark icon={prefs.nmdIcon} /><span className="sr">変動費なし</span></> : null}</span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="section card area-entry" aria-labelledby="h-entry">
          <h2 id="h-entry">入力</h2>
          <EntryForm app={app} editing={editing} onDoneEditing={onDoneEditing} />
        </section>

        <section className="section card area-month" aria-labelledby="h-month">
          <h2 id="h-month">今月の収支</h2>
          {!hasData ? <p className="muted">スプレッドシートの取得前です</p> : (
            <>
              <div className={`big num ${confirmed.balance < 0 ? 'over' : ''}`}>{yen(confirmed.balance)}</div>
              <div className="row muted num"><span>収入</span><span>{yen(confirmed.income)}</span></div>
              <div className="row muted num"><span>支出</span><span>{yen(confirmed.expense)}</span></div>
              <div className="row muted num"><span>先取り貯金・投資</span><span>{yen(confirmed.saving)}</span></div>
              {unsent.length > 0 && (
                <p className="hint">未送信 {unsent.length}件を含めると {yen(withUnsent.balance)}</p>
              )}
            </>
          )}
        </section>
    </div>
  );
}
